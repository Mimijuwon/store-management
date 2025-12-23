require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Backend will not be able to connect to Postgres.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes("render.com") ? { rejectUnauthorized: false } : undefined,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

app.use(
  cors({
    origin: FRONTEND_ORIGIN === "*" ? true : FRONTEND_ORIGIN.split(","),
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));

async function initDb() {
  if (!DATABASE_URL) return;

  // Create tables if they don't exist (simple auto-migration)
  await query(`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS components (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'pcs',
      min_stock INTEGER NOT NULL DEFAULT 0,
      location TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      category_id INTEGER REFERENCES categories(id),
      category_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usage_history (
      id SERIAL PRIMARY KEY,
      component_id INTEGER NOT NULL REFERENCES components(id),
      quantity INTEGER NOT NULL,
      type TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      date TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      personnel_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS request_items (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      component_id INTEGER NOT NULL REFERENCES components(id),
      quantity INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'ENGINEER',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE components
      ADD COLUMN IF NOT EXISTS consumable BOOLEAN NOT NULL DEFAULT TRUE;

    ALTER TABLE components
      ADD COLUMN IF NOT EXISTS category_name TEXT NOT NULL DEFAULT '';

    ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS expected_return_date TIMESTAMPTZ;

    ALTER TABLE requests
      ADD COLUMN IF NOT EXISTS face_image TEXT;

    -- Drop NOT NULL constraints from legacy request columns (component_id, quantity, description)
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'requests' AND column_name = 'component_id' AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE requests ALTER COLUMN component_id DROP NOT NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'requests' AND column_name = 'quantity' AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE requests ALTER COLUMN quantity DROP NOT NULL;
        ALTER TABLE requests ALTER COLUMN quantity SET DEFAULT 0;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'requests' AND column_name = 'description' AND is_nullable = 'NO'
      ) THEN
        ALTER TABLE requests ALTER COLUMN description DROP NOT NULL;
        ALTER TABLE requests ALTER COLUMN description SET DEFAULT '';
      END IF;
    END$$;
  `);
}

function requireAdmin(req, res, next) {
  const configured = process.env.ADMIN_TOKEN;
  if (!configured) {
    return res.status(500).json({ error: "ADMIN_TOKEN not configured on server" });
  }
  const token = req.header("X-Admin-Token");
  if (token !== configured) {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}

app.get("/health", async (_req, res) => {
  try {
    if (!DATABASE_URL) {
      return res.status(500).json({ status: "error", reason: "DATABASE_URL missing" });
    }
    await query("SELECT 1");
    res.json({ status: "ok", service: "briech-uas-backend" });
  } catch (error) {
    console.error("Healthcheck DB error", error);
    res.status(500).json({ status: "error", reason: "db_unreachable" });
  }
});

// Components
app.get("/components", async (_req, res) => {
  try {
    const result = await query(
      `SELECT
         c.*,
         cat.id   AS category_id,
         COALESCE(c.category_name, cat.name, '') AS category_name
       FROM components c
       LEFT JOIN categories cat ON c.category_id = cat.id
       ORDER BY c.created_at DESC`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Get components error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/components", async (req, res) => {
  try {
    const {
      name,
      categoryId,
      categoryName,
      quantity,
      unit,
      minStock,
      location,
      supplier,
      imageUrl,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    // Log what we're receiving for debugging
    console.log("POST /components - Received categoryName:", categoryName);

    const consumable =
      categoryName && /consumable/i.test(categoryName.toString());

    // Ensure categoryName is a string (not null/undefined)
    const finalCategoryName = categoryName ? String(categoryName).trim() : "";

    const result = await query(
      `INSERT INTO components
        (name, category_id, category_name, quantity, unit, min_stock, location, supplier, image_url, consumable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, category_id, category_name, quantity, unit, min_stock, location, supplier, image_url, consumable, created_at, updated_at`,
      [
        name,
        categoryId || null,
        finalCategoryName,
        quantity ?? 0,
        unit || "pcs",
        minStock ?? 0,
        location || "",
        supplier || "",
        imageUrl || "",
        consumable,
      ],
    );

    const saved = result.rows[0];
    console.log("POST /components - Saved component with category_name:", saved.category_name);
    
    if (!saved.category_name && finalCategoryName) {
      console.error("WARNING: category_name was not saved! Column may not exist in database.");
    }

    res.status(201).json(saved);
  } catch (error) {
    console.error("Create component error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Requests
app.get("/requests", async (_req, res) => {
  try {
    const result = await query(
      `SELECT 
         r.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id', ri.id,
               'component_id', ri.component_id,
               'quantity', ri.quantity,
               'description', ri.description,
               'component_name', c.name,
               'unit', c.unit,
               'consumable', c.consumable
             )
           ) FILTER (WHERE ri.id IS NOT NULL),
           '[]'
         ) AS items
       FROM requests r
       LEFT JOIN request_items ri ON ri.request_id = r.id
       LEFT JOIN components c ON ri.component_id = c.id
       GROUP BY r.id
       ORDER BY r.requested_at DESC`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Get requests error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/requests/outstanding", async (_req, res) => {
  try {
    const result = await query(
      `SELECT 
         r.*,
         COALESCE(
           json_agg(
             json_build_object(
               'id', ri.id,
               'component_id', ri.component_id,
               'quantity', ri.quantity,
               'description', ri.description,
               'component_name', c.name,
               'unit', c.unit,
               'consumable', c.consumable
             )
           ) FILTER (WHERE ri.id IS NOT NULL),
           '[]'
         ) AS items
       FROM requests r
       JOIN request_items ri ON ri.request_id = r.id
       JOIN components c ON ri.component_id = c.id
       WHERE r.status = 'APPROVED' AND c.consumable = FALSE
       GROUP BY r.id
       ORDER BY r.requested_at DESC`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Get outstanding requests error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/requests", async (req, res) => {
  try {
    const { personnelName, items, faceImage } = req.body;

    if (!personnelName || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: "personnelName and items are required" });
    }

    for (const item of items) {
      if (!item.componentId || !item.quantity || item.quantity <= 0) {
        return res
          .status(400)
          .json({ error: "Each item needs componentId and quantity > 0" });
      }
    }

    for (const item of items) {
      const componentRes = await query(
        `SELECT id, name, quantity FROM components WHERE id = $1`,
        [item.componentId],
      );
      if (componentRes.rowCount === 0) {
        return res.status(404).json({ error: `Component not found (id ${item.componentId})` });
      }
      const comp = componentRes.rows[0];
      if (comp.quantity <= 0 || comp.quantity < item.quantity) {
        return res.status(400).json({
          error: `Requested quantity for ${comp.name} exceeds available stock`,
          available: comp.quantity,
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const requestInsert = await client.query(
        `INSERT INTO requests (personnel_name, status, requested_at, face_image)
         VALUES ($1,'PENDING',NOW(),$2)
         RETURNING *`,
        [personnelName, faceImage || null],
      );
      const request = requestInsert.rows[0];

      for (const item of items) {
        await client.query(
          `INSERT INTO request_items (request_id, component_id, quantity, description)
           VALUES ($1,$2,$3,$4)`,
          [request.id, item.componentId, item.quantity, item.description || ""],
        );
      }

      const full = await client.query(
        `SELECT 
           r.*,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', ri.id,
                 'component_id', ri.component_id,
                 'quantity', ri.quantity,
                 'description', ri.description,
                 'component_name', c.name,
                 'unit', c.unit,
                 'consumable', c.consumable
               )
             ) FILTER (WHERE ri.id IS NOT NULL),
             '[]'
           ) AS items
         FROM requests r
         LEFT JOIN request_items ri ON ri.request_id = r.id
         LEFT JOIN components c ON ri.component_id = c.id
         WHERE r.id = $1
         GROUP BY r.id`,
        [request.id],
      );

      await client.query("COMMIT");
      client.release();
      res.status(201).json(full.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      client.release();
      throw err;
    }
  } catch (error) {
    console.error("Create request error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.patch("/requests/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body; // PENDING | APPROVED | RETURNED

    if (!["PENDING", "APPROVED", "RETURNED"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Lock the request row
      const reqRow = await client.query(
        `SELECT * FROM requests WHERE id = $1 FOR UPDATE`,
        [id],
      );

      if (reqRow.rowCount === 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(404).json({ error: "Request not found" });
      }

      const row = reqRow.rows[0];

      // Fetch items (no FOR UPDATE on grouped query); per-component updates will lock rows during UPDATE
      const itemsRes = await client.query(
        `SELECT 
           ri.id,
           ri.component_id,
           ri.quantity,
           ri.description,
           c.name AS component_name,
           c.unit AS unit,
           c.consumable AS consumable,
           c.quantity AS component_quantity
         FROM request_items ri
         JOIN components c ON ri.component_id = c.id
         WHERE ri.request_id = $1`,
        [id],
      );

      const items = itemsRes.rows || [];
      const now = new Date();

      if (items.length === 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(400).json({ error: "No items on this request" });
      }

      if (status === "APPROVED") {
        for (const item of items) {
          const qty = Number(item.quantity) || 0;
          const available = Number(item.component_quantity) || 0;
          if (available < qty) {
            await client.query("ROLLBACK");
            client.release();
            return res
              .status(400)
              .json({ error: `Insufficient stock for ${item.component_name || "item"}` });
          }
        }

        await client.query(
          `UPDATE requests
           SET status = 'APPROVED', approved_at = $1
           WHERE id = $2`,
          [now, id],
        );

        for (const item of items) {
          const qty = Number(item.quantity) || 0;
          await client.query(
            `UPDATE components
             SET quantity = quantity - $1
             WHERE id = $2`,
            [qty, item.component_id],
          );

          await client.query(
            `INSERT INTO usage_history
              (component_id, quantity, type, project, notes, date)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              item.component_id,
              -Math.abs(qty),
              "remove",
              `Request by ${row.personnel_name}`,
              item.description || "",
              now,
            ],
          );
        }
      } else if (status === "RETURNED") {
        await client.query(
          `UPDATE requests
           SET status = 'RETURNED', returned_at = $1
           WHERE id = $2`,
          [now, id],
        );

        for (const item of items) {
          if (item.consumable === false) {
            const qty = Number(item.quantity) || 0;
            await client.query(
              `UPDATE components
               SET quantity = quantity + $1
               WHERE id = $2`,
              [qty, item.component_id],
            );

            await client.query(
              `INSERT INTO usage_history
                (component_id, quantity, type, project, notes, date)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                item.component_id,
                Math.abs(qty),
                "add",
                `Return by ${row.personnel_name}`,
                item.description || "",
                now,
              ],
            );
          }
        }
      } else if (status === "PENDING") {
        await client.query(
          `UPDATE requests
           SET status = 'PENDING'
           WHERE id = $1`,
          [id],
        );
      }

      const updated = await client.query(
        `SELECT 
           r.*,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', ri.id,
                 'component_id', ri.component_id,
                 'quantity', ri.quantity,
                 'description', ri.description,
                 'component_name', c.name,
                 'unit', c.unit,
                 'consumable', c.consumable
               )
             ) FILTER (WHERE ri.id IS NOT NULL),
             '[]'
           ) AS items
         FROM requests r
         LEFT JOIN request_items ri ON ri.request_id = r.id
         LEFT JOIN components c ON ri.component_id = c.id
         WHERE r.id = $1
         GROUP BY r.id`,
        [id],
      );

      await client.query("COMMIT");
      client.release();
      res.json(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      throw error;
    }
  } catch (error) {
    console.error("Update request status error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Edit a request (only while pending)
app.patch("/requests/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { personnelName, items, faceImage } = req.body;

    if (!personnelName || !Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: "personnelName and items are required" });
    }

    for (const item of items) {
      if (!item.componentId || !item.quantity || item.quantity <= 0) {
        return res
          .status(400)
          .json({ error: "Each item needs componentId and quantity > 0" });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const reqRow = await client.query(
        `SELECT * FROM requests WHERE id = $1 FOR UPDATE`,
        [id],
      );

      if (reqRow.rowCount === 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(404).json({ error: "Request not found" });
      }

      const existing = reqRow.rows[0];
      if (existing.status !== "PENDING") {
        await client.query("ROLLBACK");
        client.release();
        return res.status(400).json({ error: "Only pending requests can be edited" });
      }

      // Validate stock for new items
      for (const item of items) {
        const componentRes = await client.query(
          `SELECT id, name, quantity FROM components WHERE id = $1`,
          [item.componentId],
        );
        if (componentRes.rowCount === 0) {
          await client.query("ROLLBACK");
          client.release();
          return res.status(404).json({ error: `Component not found (id ${item.componentId})` });
        }
        const comp = componentRes.rows[0];
        if (comp.quantity <= 0 || comp.quantity < item.quantity) {
          await client.query("ROLLBACK");
          client.release();
          return res.status(400).json({
            error: `Requested quantity for ${comp.name} exceeds available stock`,
            available: comp.quantity,
          });
        }
      }

      await client.query(
        `UPDATE requests
         SET personnel_name = $1,
             face_image = COALESCE($3, face_image)
         WHERE id = $2`,
        [personnelName, id, faceImage || null],
      );

      await client.query(`DELETE FROM request_items WHERE request_id = $1`, [id]);

      for (const item of items) {
        await client.query(
          `INSERT INTO request_items (request_id, component_id, quantity, description)
           VALUES ($1,$2,$3,$4)`,
          [id, item.componentId, item.quantity, item.description || ""],
        );
      }

      const full = await client.query(
        `SELECT 
           r.*,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', ri.id,
                 'component_id', ri.component_id,
                 'quantity', ri.quantity,
                 'description', ri.description,
                 'component_name', c.name,
                 'unit', c.unit,
                 'consumable', c.consumable
               )
             ) FILTER (WHERE ri.id IS NOT NULL),
             '[]'
           ) AS items
         FROM requests r
         LEFT JOIN request_items ri ON ri.request_id = r.id
         LEFT JOIN components c ON ri.component_id = c.id
         WHERE r.id = $1
         GROUP BY r.id`,
        [id],
      );

      await client.query("COMMIT");
      client.release();
      res.json(full.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      client.release();
      throw error;
    }
  } catch (error) {
    console.error("Edit request error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Usage history
app.get("/usage", async (_req, res) => {
  try {
    const result = await query(
      `SELECT u.*, c.name AS component_name, c.unit AS component_unit
       FROM usage_history u
       JOIN components c ON u.component_id = c.id
       ORDER BY u.date DESC`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Get usage error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Categories
app.get("/categories", async (_req, res) => {
  try {
    const result = await query(
      `SELECT * FROM categories
       ORDER BY name ASC`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Get categories error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/categories", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const result = await query(
      `INSERT INTO categories (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [name],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Create category error", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete component (and related records)
app.delete("/components/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    // Check if component exists
    const componentCheck = await query("SELECT id FROM components WHERE id = $1", [id]);
    if (componentCheck.rowCount === 0) {
      return res.status(404).json({ error: "Component not found" });
    }

    // Remove dependent rows first to satisfy foreign keys
    // Order matters: delete from child tables first
    await query("DELETE FROM usage_history WHERE component_id = $1", [id]);
    await query("DELETE FROM request_items WHERE component_id = $1", [id]);
    await query("DELETE FROM components WHERE id = $1", [id]);

    res.status(204).end();
  } catch (error) {
    console.error("Delete component error", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`API listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database init failed", error);
    process.exit(1);
  });
