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
      component_id INTEGER NOT NULL REFERENCES components(id),
      quantity INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      returned_at TIMESTAMPTZ
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
      `SELECT r.*, c.name AS component_name, c.unit AS component_unit, c.consumable
       FROM requests r
       JOIN components c ON r.component_id = c.id
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
      `SELECT r.*, c.name AS component_name, c.unit AS component_unit, c.consumable
       FROM requests r
       JOIN components c ON r.component_id = c.id
       WHERE r.status = 'APPROVED' AND c.consumable = FALSE
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
    const { personnelName, componentId, quantity, description } = req.body;

    if (!personnelName || !componentId || !quantity) {
      return res
        .status(400)
        .json({ error: "personnelName, componentId and quantity are required" });
    }

    const componentRes = await query(
      `SELECT id, name, quantity
       FROM components
       WHERE id = $1`,
      [componentId],
    );
    if (componentRes.rowCount === 0) {
      return res.status(404).json({ error: "Component not found" });
    }
    const comp = componentRes.rows[0];
    if (comp.quantity <= 0 || comp.quantity < quantity) {
      return res.status(400).json({
        error: "Requested quantity exceeds available stock",
        available: comp.quantity,
      });
    }

    const result = await query(
      `INSERT INTO requests
        (personnel_name, component_id, quantity, description, status, requested_at)
       VALUES ($1,$2,$3,$4,'PENDING',NOW())
       RETURNING *`,
      [personnelName, componentId, quantity, description || ""],
    );

    res.status(201).json(result.rows[0]);
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

      const existing = await client.query(
        `SELECT r.*, c.quantity AS component_quantity, c.consumable, c.id AS component_id
         FROM requests r
         JOIN components c ON r.component_id = c.id
         WHERE r.id = $1
         FOR UPDATE`,
        [id],
      );

      if (existing.rowCount === 0) {
        await client.query("ROLLBACK");
        client.release();
        return res.status(404).json({ error: "Request not found" });
      }

      const row = existing.rows[0];
      const now = new Date();

      if (status === "APPROVED") {
        if (row.component_quantity < row.quantity) {
          await client.query("ROLLBACK");
          client.release();
          return res.status(400).json({ error: "Insufficient stock" });
        }

        await client.query(
          `UPDATE requests
           SET status = 'APPROVED', approved_at = $1
           WHERE id = $2`,
          [now, id],
        );

        await client.query(
          `UPDATE components
           SET quantity = quantity - $1
           WHERE id = $2`,
          [row.quantity, row.component_id],
        );

        await client.query(
          `INSERT INTO usage_history
            (component_id, quantity, type, project, notes, date)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            row.component_id,
            -Math.abs(row.quantity),
            "remove",
            `Request by ${row.personnel_name}`,
            row.description || "",
            now,
          ],
        );
      } else if (status === "RETURNED") {
        await client.query(
          `UPDATE requests
           SET status = 'RETURNED', returned_at = $1
           WHERE id = $2`,
          [now, id],
        );

        if (row.consumable === false) {
          await client.query(
            `UPDATE components
             SET quantity = quantity + $1
             WHERE id = $2`,
            [row.quantity, row.component_id],
          );

          await client.query(
            `INSERT INTO usage_history
              (component_id, quantity, type, project, notes, date)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              row.component_id,
              Math.abs(row.quantity),
              "add",
              `Return by ${row.personnel_name}`,
              row.description || "",
              now,
            ],
          );
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
        `SELECT r.*, c.name AS component_name, c.unit AS component_unit, c.consumable
         FROM requests r
         JOIN components c ON r.component_id = c.id
         WHERE r.id = $1`,
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

    // Remove dependent rows first to satisfy foreign keys
    await query("DELETE FROM usage_history WHERE component_id = $1", [id]);
    await query("DELETE FROM requests WHERE component_id = $1", [id]);
    await query("DELETE FROM components WHERE id = $1", [id]);

    res.status(204).end();
  } catch (error) {
    console.error("Delete component error", error);
    res.status(500).json({ error: "Internal server error" });
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
