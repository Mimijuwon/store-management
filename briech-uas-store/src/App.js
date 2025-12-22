import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ClipboardList,
  Minus,
  Package,
  Plus,
  Search,
} from "lucide-react";

const API_BASE = process.env.REACT_APP_API_URL;

const storage = {
  async get(key) {
    // If an API is configured, prefer backend and let frontend use localStorage only as cache
    if (API_BASE) return null;
    if (window.storage?.get) {
      return window.storage.get(key);
    }

    const value = window.localStorage.getItem(key);
    return value ? { value } : null;
  },
  async set(key, value) {
    if (window.storage?.set) {
      return window.storage.set(key, value);
    }

    window.localStorage.setItem(key, value);
    return undefined;
  },
};

const fromApiComponent = (raw) => ({
  id: raw.id,
  name: raw.name,
  category: raw.category_name || raw.category || "",
  quantity: raw.quantity ?? 0,
  unit: raw.unit || "pcs",
  minStock: raw.min_stock ?? raw.minStock ?? 0,
  location: raw.location || "",
  supplier: raw.supplier || "",
  image: raw.image_url || raw.imageUrl || null,
  addedDate: raw.created_at || raw.addedDate || null,
});

const fromApiRequest = (raw) => ({
  id: raw.id,
  personnelName: raw.personnel_name || raw.personnelName || "",
  componentId: raw.component_id ?? raw.componentId,
  componentName: raw.component_name || raw.componentName || "",
  quantity: raw.quantity ?? 0,
  description: raw.description || "",
  status: (raw.status || "").toLowerCase() || "pending",
  requestedAt: raw.requested_at || raw.requestedAt || null,
  approvedAt: raw.approved_at || raw.approvedAt || null,
  returnedAt: raw.returned_at || raw.returnedAt || null,
  consumable:
    typeof raw.consumable === "boolean"
      ? raw.consumable
      : raw.consumable === "false"
      ? false
      : true,
});

const fromApiUsage = (raw) => ({
  id: raw.id,
  componentId: raw.component_id ?? raw.componentId,
  componentName: raw.component_name || raw.componentName || "",
  quantity: raw.quantity ?? 0,
  type: (raw.type || "").toLowerCase(),
  project: raw.project || "",
  notes: raw.notes || "",
  date: raw.date || null,
});

export default function BriechStorageSystem() {
  const DEFAULT_CATEGORIES = [
    "Consumables",
    "Non-consumables",
    "Batteries",
    "Tools",
    "Drone - DJI",
    "Drone - VTOL",
    "Electronics",
  ];

  const [components, setComponents] = useState([]);
  const [usageHistory, setUsageHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("inventory");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState(null);
  const [requests, setRequests] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);

  const [newComponent, setNewComponent] = useState({
    name: "",
    category: "Electronics",
    quantity: 0,
    unit: "pcs",
    minStock: 5,
    location: "",
    supplier: "",
    image: null,
  });

  const [usageRecord, setUsageRecord] = useState({
    quantity: 0,
    project: "",
    notes: "",
  });

  const [newRequest, setNewRequest] = useState({
    personnelName: "",
    componentId: "",
    quantity: 1,
    description: "",
  });

  const [requestQuickFilter, setRequestQuickFilter] = useState("today"); // today | week | month | all
  const [requestStatusFilter, setRequestStatusFilter] = useState("all"); // all | pending | approved | returned
  const [newCategoryName, setNewCategoryName] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        if (API_BASE) {
          const [componentsRes, usageRes, requestsRes, categoriesRes] =
            await Promise.all([
              fetch(`${API_BASE}/components`),
              fetch(`${API_BASE}/usage`),
              fetch(`${API_BASE}/requests`),
              fetch(`${API_BASE}/categories`),
            ]);

          if (componentsRes.ok) {
            const data = await componentsRes.json();
            setComponents(Array.isArray(data) ? data.map(fromApiComponent) : []);
          }
          if (usageRes.ok) {
            const data = await usageRes.json();
            setUsageHistory(Array.isArray(data) ? data.map(fromApiUsage) : []);
          }
          if (requestsRes.ok) {
            const data = await requestsRes.json();
            setRequests(Array.isArray(data) ? data.map(fromApiRequest) : []);
          }
          if (categoriesRes.ok) {
            const serverCategories = await categoriesRes.json();
            if (Array.isArray(serverCategories) && serverCategories.length > 0) {
              setCategories(serverCategories.map((cat) => cat.name ?? cat));
            }
          }
        } else {
          const componentsResult = await storage.get("briech-components");
          const usageResult = await storage.get("briech-usage-history");
          const requestsResult = await storage.get("briech-requests");
          const categoriesResult = await storage.get("briech-categories");

          if (componentsResult?.value) {
            setComponents(JSON.parse(componentsResult.value));
          }
          if (usageResult?.value) {
            setUsageHistory(JSON.parse(usageResult.value));
          }
          if (requestsResult?.value) {
            setRequests(JSON.parse(requestsResult.value));
          }
          if (categoriesResult?.value) {
            const parsed = JSON.parse(categoriesResult.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setCategories(parsed);
            }
          }
        }
      } catch (error) {
        console.warn("Unable to restore data", error);
      }
    };

    loadData();
  }, []);

  const saveData = async (newComponents, newUsageHistory) => {
    try {
      if (!API_BASE) {
        await storage.set("briech-components", JSON.stringify(newComponents));
        await storage.set(
          "briech-usage-history",
          JSON.stringify(newUsageHistory),
        );
      }
    } catch (error) {
      console.error("Error saving data:", error);
    }
  };

  const handleAddComponent = async () => {
    if (!newComponent.name || newComponent.quantity < 0) return;

    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/components`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newComponent.name,
            categoryId: null, // mapping of category name to ID can be added later
            quantity: newComponent.quantity,
            unit: newComponent.unit,
            minStock: newComponent.minStock,
            location: newComponent.location,
            supplier: newComponent.supplier,
            imageUrl: newComponent.image,
          }),
        });
        if (response.ok) {
          const created = await response.json();
          setComponents((prev) => [fromApiComponent(created), ...prev]);
        }
      } catch (error) {
        console.error("Error creating component via API", error);
      }
    } else {
      const component = {
        ...newComponent,
        id: Date.now().toString(),
        addedDate: new Date().toISOString(),
      };

      const updated = [...components, component];
      setComponents(updated);
      await saveData(updated, usageHistory);
    }

    setNewComponent({
      name: "",
      category: "Electronics",
      quantity: 0,
      unit: "pcs",
      minStock: 5,
      location: "",
      supplier: "",
      image: null,
    });
    setShowAddModal(false);
  };

  const handleRecordUsage = async (type) => {
    if (!selectedComponent || usageRecord.quantity <= 0) return;

    const quantity =
      type === "remove"
        ? -Math.abs(usageRecord.quantity)
        : Math.abs(usageRecord.quantity);

    const updatedComponents = components.map((component) =>
      component.id === selectedComponent.id
        ? { ...component, quantity: Math.max(0, component.quantity + quantity) }
        : component,
    );

    const usage = {
      id: Date.now().toString(),
      componentId: selectedComponent.id,
      componentName: selectedComponent.name,
      quantity,
      type,
      project: usageRecord.project,
      notes: usageRecord.notes,
      date: new Date().toISOString(),
    };

    const updatedUsage = [usage, ...usageHistory];

    setComponents(updatedComponents);
    setUsageHistory(updatedUsage);
    await saveData(updatedComponents, updatedUsage);

    setUsageRecord({ quantity: 0, project: "", notes: "" });
    setShowUsageModal(false);
    setSelectedComponent(null);
  };

  const handleDeleteComponent = async (id) => {
    if (API_BASE) {
      try {
        await fetch(`${API_BASE}/components/${id}`, {
          method: "DELETE",
          headers: {
            "X-Admin-Token": process.env.REACT_APP_ADMIN_TOKEN || "",
          },
        });
      } catch (error) {
        console.error("Error deleting component via API", error);
      }
      setComponents((prev) =>
        prev.filter((component) => String(component.id) !== String(id)),
      );
    } else {
      const updated = components.filter((component) => component.id !== id);
      setComponents(updated);
      await saveData(updated, usageHistory);
    }
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (categories.some((category) => category.toLowerCase() === name.toLowerCase())) {
      setNewCategoryName("");
      setNewComponent((prev) => ({ ...prev, category: name }));
      return;
    }

    const updatedCategories = [...categories, name];
    setCategories(updatedCategories);
    setNewCategoryName("");
    setNewComponent((prev) => ({ ...prev, category: name }));
    try {
      if (API_BASE) {
        await fetch(`${API_BASE}/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
      } else {
        await storage.set("briech-categories", JSON.stringify(updatedCategories));
      }
    } catch (error) {
      console.error("Error saving categories:", error);
    }
  };

  const handleCreateRequest = async () => {
    if (
      !newRequest.personnelName ||
      !newRequest.componentId ||
      newRequest.quantity <= 0
    ) {
      return;
    }

    const component = components.find(
      (componentItem) => String(componentItem.id) === String(newRequest.componentId),
    );
    if (!component) return;

    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personnelName: newRequest.personnelName,
            componentId: component.id,
            quantity: newRequest.quantity,
            description: newRequest.description,
          }),
        });
        if (response.ok) {
          const created = await response.json();
          setRequests((prev) => [fromApiRequest(created), ...prev]);
        }
      } catch (error) {
        console.error("Error creating request via API", error);
      }
    } else {
      const request = {
        id: Date.now().toString(),
        personnelName: newRequest.personnelName,
        componentId: component.id,
        componentName: component.name,
        quantity: newRequest.quantity,
        description: newRequest.description,
        status: "pending", // pending -> approved -> returned
        requestedAt: new Date().toISOString(),
        approvedAt: null,
        returnedAt: null,
      };

      const updatedRequests = [request, ...requests];
      setRequests(updatedRequests);
      await storage.set("briech-requests", JSON.stringify(updatedRequests));
    }

    setNewRequest({
      personnelName: "",
      componentId: "",
      quantity: 1,
      description: "",
    });
    setShowRequestModal(false);
  };

  const recordUsageForRequest = async (request, type) => {
    const component = components.find(
      (component) => component.id === request.componentId,
    );
    if (!component) return;

    const quantity =
      type === "remove" ? -Math.abs(request.quantity) : Math.abs(request.quantity);

    const updatedComponents = components.map((component) =>
      component.id === request.componentId
        ? {
            ...component,
            quantity: Math.max(0, component.quantity + quantity),
          }
        : component,
    );

    const usage = {
      id: `${Date.now().toString()}-${type}`,
      componentId: component.id,
      componentName: component.name,
      quantity,
      type,
      project: `Request by ${request.personnelName}`,
      notes: request.description,
      date: new Date().toISOString(),
    };

    const updatedUsage = [usage, ...usageHistory];
    setComponents(updatedComponents);
    setUsageHistory(updatedUsage);
    await saveData(updatedComponents, updatedUsage);
  };

  const updateRequestStatus = async (id, nextStatus) => {
    const now = new Date().toISOString();
    let targetRequest = null;

    const updatedRequests = requests.map((request) => {
      if (request.id !== id) return request;
      targetRequest = { ...request };

      if (nextStatus === "approved") {
        targetRequest.status = "approved";
        targetRequest.approvedAt = now;
      } else if (nextStatus === "returned") {
        targetRequest.status = "returned";
        targetRequest.returnedAt = now;
      }

      return targetRequest;
    });

    if (!targetRequest) return;

    // Adjust stock when request is approved (issue) and when item is returned
    if (!API_BASE) {
      if (nextStatus === "approved") {
        await recordUsageForRequest(targetRequest, "remove");
      } else if (nextStatus === "returned") {
        await recordUsageForRequest(targetRequest, "add");
      }

      setRequests(updatedRequests);
      await storage.set("briech-requests", JSON.stringify(updatedRequests));
    } else {
      try {
        const response = await fetch(`${API_BASE}/requests/${id}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Token": process.env.REACT_APP_ADMIN_TOKEN || "",
          },
          body: JSON.stringify({
            status:
              nextStatus === "approved"
                ? "APPROVED"
                : nextStatus === "returned"
                ? "RETURNED"
                : "PENDING",
          }),
        });
        if (response.ok) {
          const serverRequest = await response.json();
          setRequests((prev) =>
            prev.map((request) =>
              request.id === id ? serverRequest : request,
            ),
          );
        }
      } catch (error) {
        console.error("Error updating request via API", error);
      }
    }
  };

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewComponent((prev) => ({ ...prev, image: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const filteredComponents = useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return components;

    return components.filter((component) => {
      const fields = [
        component.name,
        component.category,
        component.location,
        component.supplier,
      ].filter(Boolean);

      return fields.some((field) =>
        field.toLowerCase().includes(term),
      );
    });
  }, [components, searchTerm]);

  const lowStockItems = components.filter(
    (component) => component.quantity <= component.minStock,
  );

  const categoryStats = useMemo(() => {
    const categories = [...new Set(components.map((component) => component.category))];
    return categories.map((category) => {
      const items = components.filter((component) => component.category === category);
      return {
        category,
        count: items.length,
      };
    });
  }, [components]);

  const categoryWidth = (count) =>
    components.length ? `${(count / components.length) * 100}%` : "0%";

  const requestStats = useMemo(() => {
    const pending = requests.filter(
      (request) => request.status === "pending",
    ).length;
    const approved = requests.filter(
      (request) => request.status === "approved",
    ).length;
    const returned = requests.filter(
      (request) => request.status === "returned",
    ).length;
    const outstanding = requests.filter(
      (request) =>
        request.status === "approved" && request.consumable === false,
    ).length;

    return {
      pending,
      approved,
      returned,
      outstanding,
      total: requests.length,
    };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    if (requestQuickFilter === "all") {
      return requests;
    }

    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const isSameDay = (date) => {
      const d = new Date(date);
      return (
        d.getFullYear() === startOfToday.getFullYear() &&
        d.getMonth() === startOfToday.getMonth() &&
        d.getDate() === startOfToday.getDate()
      );
    };

    const isThisWeek = (date) => {
      const d = new Date(date);
      const day = startOfToday.getDay(); // 0 (Sun) - 6 (Sat)
      const diff = startOfToday.getDate() - day;
      const startOfWeek = new Date(
        startOfToday.getFullYear(),
        startOfToday.getMonth(),
        diff,
      );
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      return d >= startOfWeek && d < endOfWeek;
    };

    const isThisMonth = (date) => {
      const d = new Date(date);
      return (
        d.getFullYear() === startOfToday.getFullYear() &&
        d.getMonth() === startOfToday.getMonth()
      );
    };

    const byQuickFilter = requests.filter((request) => {
      const requestedAt = request.requestedAt;
      if (!requestedAt) return false;

      if (requestQuickFilter === "today") return isSameDay(requestedAt);
      if (requestQuickFilter === "week") return isThisWeek(requestedAt);
      if (requestQuickFilter === "month") return isThisMonth(requestedAt);
      return true;
    });

    return byQuickFilter.filter((request) => {
      if (requestStatusFilter === "all") return true;
      return request.status === requestStatusFilter;
    });
  }, [requests, requestQuickFilter, requestStatusFilter]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-600 text-white px-4 py-4 sm:px-6 sm:py-6 shadow-lg">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Package size={32} />
              <div>
                <h1 className="text-2xl font-bold">Briech UAS Storage System</h1>
                <p className="text-blue-100 text-sm">
                  Component Inventory & Usage Tracking
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-white text-blue-600 px-4 py-2 rounded-lg font-semibold hover:bg-blue-50 flex items-center gap-2"
            >
              <Plus size={20} />
              Add Component
            </button>
          </div>
        </div>
      </div>

      {lowStockItems.length > 0 && (
        <div className="max-w-7xl mx-auto mt-4 px-4">
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-yellow-600" size={20} />
              <span className="font-semibold text-yellow-800">
                {lowStockItems.length} component
                {lowStockItems.length === 1 ? "" : "s"} below minimum stock level
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-4">
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="flex border-b overflow-x-auto">
            <button
              onClick={() => setActiveTab("inventory")}
              className={`px-6 py-3 font-semibold flex items-center gap-2 ${
                activeTab === "inventory"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              <Package size={20} />
              Inventory
            </button>
            <button
              onClick={() => setActiveTab("usage")}
              className={`px-6 py-3 font-semibold flex items-center gap-2 ${
                activeTab === "usage"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              <Activity size={20} />
              Usage History
            </button>
            <button
              onClick={() => setActiveTab("analytics")}
              className={`px-6 py-3 font-semibold flex items-center gap-2 ${
                activeTab === "analytics"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              <BarChart3 size={20} />
              Analytics
            </button>
            <button
              onClick={() => setActiveTab("requests")}
              className={`px-6 py-3 font-semibold flex items-center gap-2 ${
                activeTab === "requests"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              <ClipboardList size={20} />
              Requests
            </button>
          </div>
        </div>

        {activeTab === "inventory" && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="flex items-center gap-2 mb-4 border-b pb-2">
                <Search size={20} className="text-gray-400" />
                <input
                  type="text"
                  placeholder="Search components..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="flex-1 border-0 focus:ring-0 text-lg"
                />
              </div>
            </div>

            <div className="grid gap-4">
              {filteredComponents.map((component) => (
                <div
                  key={component.id}
                  className="bg-white p-4 rounded-lg shadow hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between gap-4">
                    {component.image && (
                      <img
                        src={component.image}
                        alt={component.name}
                        className="w-24 h-24 object-cover rounded-lg"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-xl font-bold text-gray-800">
                          {component.name}
                        </h3>
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
                          {component.category}
                        </span>
                        {component.quantity <= component.minStock && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-sm flex items-center gap-1">
                            <AlertTriangle size={14} />
                            Low Stock
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600">
                        <div>
                          <span className="font-semibold">Quantity:</span>{" "}
                          {component.quantity} {component.unit}
                        </div>
                        <div>
                          <span className="font-semibold">Min Stock:</span>{" "}
                          {component.minStock} {component.unit}
                        </div>
                        <div>
                          <span className="font-semibold">Location:</span>{" "}
                          {component.location || "N/A"}
                        </div>
                        <div>
                          <span className="font-semibold">Supplier:</span>{" "}
                          {component.supplier || "N/A"}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-col sm:flex-row">
                      <button
                        onClick={() => {
                          setSelectedComponent(component);
                          setShowUsageModal(true);
                        }}
                        className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1 justify-center"
                      >
                        <Plus size={16} />
                        Add
                      </button>
                      <button
                        onClick={() => {
                          setSelectedComponent(component);
                          setShowUsageModal(true);
                        }}
                        className="px-3 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 flex items-center gap-1 justify-center"
                      >
                        <Minus size={16} />
                        Use
                      </button>
                      <button
                        onClick={() => handleDeleteComponent(component.id)}
                        className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {filteredComponents.length === 0 && (
                <div className="bg-white p-12 rounded-lg shadow text-center text-gray-500">
                  <Package size={48} className="mx-auto mb-4 text-gray-300" />
                  <p className="text-lg">No components found</p>
                  <p className="text-sm">Add your first component to get started</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "usage" && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="text-xl font-bold">Usage History</h2>
            </div>
            <div className="divide-y">
              {usageHistory.map((usage) => (
                <div key={usage.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-800">
                          {usage.componentName}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-sm ${
                            usage.type === "add"
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {usage.quantity > 0 ? "+" : ""}
                          {usage.quantity}
                        </span>
                      </div>
                      {usage.project && (
                        <p className="text-sm text-gray-600">
                          Project: {usage.project}
                        </p>
                      )}
                      {usage.notes && (
                        <p className="text-sm text-gray-500 mt-1">{usage.notes}</p>
                      )}
                    </div>
                    <div className="text-right text-sm text-gray-500">
                      {new Date(usage.date).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}

              {usageHistory.length === 0 && (
                <div className="p-12 text-center text-gray-500">
                  <Activity size={48} className="mx-auto mb-4 text-gray-300" />
                  <p>No usage history yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">
                  Total Components
                </h3>
                <p className="text-3xl font-bold text-blue-600">
                  {components.length}
                </p>
              </div>
              <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">
                  Low Stock Items
                </h3>
                <p className="text-3xl font-bold text-yellow-600">
                  {lowStockItems.length}
                </p>
              </div>
              <div className="bg-white p-4 sm:p-6 rounded-lg shadow">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">
                  Total Transactions
                </h3>
                <p className="text-3xl font-bold text-green-600">
                  {usageHistory.length}
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-bold mb-4">Category Overview</h3>
              <div className="space-y-4">
                {categoryStats.map((stat) => (
                  <div key={stat.category}>
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold">{stat.category}</span>
                      <span className="text-gray-600">
                        {stat.count} item{stat.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: categoryWidth(stat.count) }}
                      />
                    </div>
                  </div>
                ))}

                {categoryStats.length === 0 && (
                  <p className="text-center text-gray-500 py-8">No data available</p>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "requests" && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-lg shadow space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold">Sign-off Requests</h2>
                  <p className="text-sm text-gray-500">
                    Track pending, approved, and returned items, including those still out.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs font-semibold text-gray-700">
                  <span className="px-3 py-1 rounded-full bg-slate-100">
                    Total: {requestStats.total}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-yellow-50 text-yellow-800">
                    Pending: {requestStats.pending}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-800">
                    Approved (Out): {requestStats.outstanding}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-green-50 text-green-800">
                    Returned: {requestStats.returned}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Date scope
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setRequestQuickFilter("today")}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        requestQuickFilter === "today"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestQuickFilter("week")}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        requestQuickFilter === "week"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      This Week
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestQuickFilter("month")}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        requestQuickFilter === "month"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      This Month
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestQuickFilter("all")}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        requestQuickFilter === "all"
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      All
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    Status scope
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setRequestStatusFilter("all")}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        requestStatusFilter === "all"
                          ? "bg-slate-800 text-white border-slate-800"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      All Status
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestStatusFilter("pending")}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        requestStatusFilter === "pending"
                          ? "bg-yellow-500 text-white border-yellow-500"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      Pending
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestStatusFilter("approved")}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        requestStatusFilter === "approved"
                          ? "bg-blue-500 text-white border-blue-500"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      Approved
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestStatusFilter("returned")}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                        requestStatusFilter === "returned"
                          ? "bg-green-500 text-white border-green-500"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      Returned
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => setShowRequestModal(true)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 flex items-center gap-2 self-start sm:self-auto"
                >
                  <Plus size={18} />
                  New Request
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Personnel
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Item
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Qty
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Status
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Timeline
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRequests.map((request) => (
                    <tr key={request.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-semibold">
                          {request.personnelName}
                        </div>
                        {request.description && (
                          <div className="text-xs text-gray-500">
                            {request.description}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {request.componentName}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {request.quantity}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-semibold ${
                            request.status === "pending"
                              ? "bg-yellow-100 text-yellow-700"
                              : request.status === "approved"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-green-100 text-green-700"
                          }`}
                        >
                          {request.status === "pending" && "Pending Approval"}
                          {request.status === "approved" && "Approved"}
                          {request.status === "returned" && "Returned"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600 space-y-1">
                        <div>
                          <span className="font-semibold">Requested:</span>{" "}
                          {new Date(request.requestedAt).toLocaleString()}
                        </div>
                        {request.returnedAt && (
                          <div>
                            <span className="font-semibold">Returned:</span>{" "}
                            {new Date(request.returnedAt).toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {request.status === "pending" && (
                            <button
                              onClick={() =>
                                updateRequestStatus(request.id, "approved")
                              }
                              className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                            >
                              Approve
                            </button>
                          )}
                          {request.status === "approved" && (
                            <button
                              onClick={() =>
                                updateRequestStatus(request.id, "returned")
                              }
                              className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                            >
                              Mark Returned
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredRequests.length === 0 && (
                    <tr>
                      <td
                        className="px-3 py-6 text-center text-gray-500"
                        colSpan={6}
                      >
                        No requests yet. Click &quot;New Request&quot; to
                        create one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">Add New Component</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Component Image
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                  {newComponent.image ? (
                    <div className="space-y-2">
                      <img
                        src={newComponent.image}
                        alt="Preview"
                        className="w-full h-48 object-cover rounded-lg"
                      />
                      <button
                        onClick={() =>
                          setNewComponent((prev) => ({ ...prev, image: null }))
                        }
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        Remove Image
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center space-y-2">
                      <Package size={48} className="text-gray-400" />
                      <p className="text-sm text-gray-600">Click to upload image</p>
                      <p className="text-xs text-gray-400">PNG, JPG up to 10MB</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
              </div>
              <input
                type="text"
                placeholder="Component Name"
                value={newComponent.name}
                onChange={(event) =>
                  setNewComponent((prev) => ({ ...prev, name: event.target.value }))
                }
                className="w-full border rounded p-2"
              />
              <div className="space-y-2">
                <label className="block text-sm font-semibold">
                  Category
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={newComponent.category}
                    onChange={(event) =>
                      setNewComponent((prev) => ({
                        ...prev,
                        category: event.target.value,
                      }))
                    }
                    className="w-full border rounded p-2 sm:w-1/2"
                  >
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-1 gap-2">
                    <input
                      type="text"
                      placeholder="New category (optional)"
                      value={newCategoryName}
                      onChange={(event) =>
                        setNewCategoryName(event.target.value)
                      }
                      className="flex-1 border rounded p-2"
                    />
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      className="px-3 py-2 bg-slate-800 text-white rounded font-semibold text-xs hover:bg-slate-900 whitespace-nowrap"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="number"
                  placeholder="Quantity"
                  value={newComponent.quantity}
                  onChange={(event) =>
                    setNewComponent((prev) => ({
                      ...prev,
                      quantity: parseInt(event.target.value, 10) || 0,
                    }))
                  }
                  className="w-full border rounded p-2"
                />
                <input
                  type="text"
                  placeholder="Unit (pcs, kg, etc)"
                  value={newComponent.unit}
                  onChange={(event) =>
                    setNewComponent((prev) => ({ ...prev, unit: event.target.value }))
                  }
                  className="w-full border rounded p-2"
                />
              </div>
              <input
                type="number"
                placeholder="Minimum Stock Level"
                value={newComponent.minStock}
                onChange={(event) =>
                  setNewComponent((prev) => ({
                    ...prev,
                    minStock: parseInt(event.target.value, 10) || 0,
                  }))
                }
                className="w-full border rounded p-2"
              />
              <input
                type="text"
                placeholder="Storage Location"
                value={newComponent.location}
                onChange={(event) =>
                  setNewComponent((prev) => ({ ...prev, location: event.target.value }))
                }
                className="w-full border rounded p-2"
              />
              <input
                type="text"
                placeholder="Supplier"
                value={newComponent.supplier}
                onChange={(event) =>
                  setNewComponent((prev) => ({ ...prev, supplier: event.target.value }))
                }
                className="w-full border rounded p-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddComponent}
                  className="flex-1 bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700"
                >
                  Add Component
                </button>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded font-semibold hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showUsageModal && selectedComponent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-2xl font-bold mb-4">
              Record Usage: {selectedComponent.name}
            </h2>
            <div className="space-y-4">
              <input
                type="number"
                placeholder="Quantity"
                value={usageRecord.quantity}
                onChange={(event) =>
                  setUsageRecord((prev) => ({
                    ...prev,
                    quantity: parseInt(event.target.value, 10) || 0,
                  }))
                }
                className="w-full border rounded p-2"
              />
              <input
                type="text"
                placeholder="Project Name"
                value={usageRecord.project}
                onChange={(event) =>
                  setUsageRecord((prev) => ({ ...prev, project: event.target.value }))
                }
                className="w-full border rounded p-2"
              />
              <textarea
                placeholder="Notes (optional)"
                value={usageRecord.notes}
                onChange={(event) =>
                  setUsageRecord((prev) => ({ ...prev, notes: event.target.value }))
                }
                className="w-full border rounded p-2"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleRecordUsage("add")}
                  className="flex-1 bg-green-600 text-white py-2 rounded font-semibold hover:bg-green-700 flex items-center justify-center gap-2"
                >
                  <Plus size={20} />
                  Add Stock
                </button>
                <button
                  onClick={() => handleRecordUsage("remove")}
                  className="flex-1 bg-orange-600 text-white py-2 rounded font-semibold hover:bg-orange-700 flex items-center justify-center gap-2"
                >
                  <Minus size={20} />
                  Use Stock
                </button>
              </div>
              <button
                onClick={() => {
                  setShowUsageModal(false);
                  setSelectedComponent(null);
                  setUsageRecord({ quantity: 0, project: "", notes: "" });
                }}
                className="w-full bg-gray-300 text-gray-700 py-2 rounded font-semibold hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showRequestModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">New Sign-off Request</h2>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Personnel Name"
                value={newRequest.personnelName}
                onChange={(event) =>
                  setNewRequest((prev) => ({
                    ...prev,
                    personnelName: event.target.value,
                  }))
                }
                className="w-full border rounded p-2"
              />
              <select
                value={newRequest.componentId}
                onChange={(event) =>
                  setNewRequest((prev) => ({
                    ...prev,
                    componentId: event.target.value,
                  }))
                }
                className="w-full border rounded p-2"
              >
                <option value="">Select Item</option>
                {components.map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.name} ({component.quantity} {component.unit} in stock)
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Quantity"
                min={1}
                value={newRequest.quantity}
                onChange={(event) =>
                  setNewRequest((prev) => ({
                    ...prev,
                    quantity: parseInt(event.target.value, 10) || 1,
                  }))
                }
                className="w-full border rounded p-2"
              />
              <textarea
                placeholder="Item type / description (optional)"
                value={newRequest.description}
                onChange={(event) =>
                  setNewRequest((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
                className="w-full border rounded p-2"
                rows={3}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateRequest}
                  className="flex-1 bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700"
                >
                  Submit Request
                </button>
                <button
                  onClick={() => setShowRequestModal(false)}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded font-semibold hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
