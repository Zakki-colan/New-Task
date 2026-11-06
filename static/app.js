const API_BASE = window.location.port === "8000"
  ? ""
  : `${window.location.protocol}//${window.location.hostname}:8000`;
const AVATAR_COLORS = [
  ["#f0edff", "#7564d7"],
  ["#e8f4ff", "#4d83b8"],
  ["#fff1e8", "#cf8752"],
  ["#e7f7f0", "#459b77"],
  ["#fdebf0", "#be6480"],
  ["#fff6dc", "#ad8840"],
];

const state = {
  employees: [],
  departments: [],
  analytics: null,
  page: 1,
  pageSize: 10,
  employeeTotal: 0,
  loadSequence: 0,
  searchTimer: null,
  pendingDelete: null,
  toastTimer: null,
};

const elements = {
  rows: document.querySelector("#employeeRows"),
  search: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearchButton"),
  departmentFilter: document.querySelector("#departmentFilter"),
  sort: document.querySelector("#sortSelect"),
  employeeDialog: document.querySelector("#employeeDialog"),
  departmentDialog: document.querySelector("#departmentDialog"),
  confirmDeleteDialog: document.querySelector("#confirmDeleteDialog"),
  employeeForm: document.querySelector("#employeeForm"),
  departmentForm: document.querySelector("#departmentForm"),
  employeeError: document.querySelector("#employeeFormError"),
  departmentError: document.querySelector("#departmentFormError"),
  employeePosition: document.querySelector("#employeePosition"),
  directoryStatus: document.querySelector("#directoryStatus"),
  toast: document.querySelector("#toast"),
};

async function request(path, options = {}, onResponse = null) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        message = body.detail.map((issue) => {
          const location = Array.isArray(issue.loc)
            ? issue.loc.filter((part) => part !== "body").join(".")
            : "";
          const field = location ? `${location}: ` : "";
          return `${field}${issue.msg}`;
        }).join("; ");
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(message);
  }

  if (onResponse) onResponse(response);
  if (response.status === 204) return null;
  return response.json();
}

async function loadDashboard() {
  const loadSequence = ++state.loadSequence;
  showTableMessage("Loading your team…");
  elements.directoryStatus.textContent = "Updating…";
  try {
    const params = new URLSearchParams({
      skip: String((state.page - 1) * state.pageSize),
      limit: String(state.pageSize),
      sort_by: document.querySelector("#sortSelect").value.split("-")[0],
      order: document.querySelector("#sortSelect").value.split("-")[1],
    });
    const departmentId = elements.departmentFilter.value;
    const search = elements.search.value.trim();
    if (departmentId) params.set("department_id", departmentId);
    if (search) params.set("search", search);

    let totalCount = 0;
    const [employees, departments, analytics] = await Promise.all([
      request(`/employees?${params}`, {}, (response) => {
        totalCount = Number(response.headers.get("X-Total-Count")) || 0;
      }),
      request("/departments"),
      request("/analytics/employees"),
    ]);
    if (loadSequence !== state.loadSequence) return;
    const lastPage = Math.max(1, Math.ceil(totalCount / state.pageSize));
    if (state.page > lastPage) {
      state.page = lastPage;
      await loadDashboard();
      return;
    }
    state.employeeTotal = totalCount;
    state.employees = employees;
    state.departments = departments;
    state.analytics = analytics;
    populateDepartmentControls();
    renderDashboard();
    elements.directoryStatus.textContent = "Up to date";
  } catch (error) {
    if (loadSequence !== state.loadSequence) return;
    showTableMessage("Could not load the directory. Check that the API and database are available.");
    elements.directoryStatus.textContent = "Connection issue";
    showToast(error.message, true);
  }
}

function populateDepartmentControls() {
  const filterValue = elements.departmentFilter.value;
  const filterOptions = ['<option value="">All departments</option>'];
  const formOptions = ['<option value="">Select a department</option>'];

  for (const department of state.departments) {
    const name = escapeHtml(department.name);
    filterOptions.push(`<option value="${department.id}">${name}</option>`);
    formOptions.push(`<option value="${department.id}">${name}</option>`);
  }

  elements.departmentFilter.innerHTML = filterOptions.join("");
  elements.departmentFilter.value = filterValue;
  document.querySelector("#employeeDepartment").innerHTML = formOptions.join("");
}

function renderDashboard() {
  renderStats();
  renderAnalytics();
  elements.clearSearch.hidden = elements.search.value.length === 0;
  const visibleEmployees = state.employees;

  if (visibleEmployees.length === 0) {
    const message = state.employeeTotal === 0
      ? "No employees yet. Add your first team member to get started."
      : "No employees on this page.";
    showTableMessage(message);
  } else {
    elements.rows.innerHTML = visibleEmployees.map(renderEmployeeRow).join("");
    elements.rows.classList.remove("rows-entering");
    requestAnimationFrame(() => elements.rows.classList.add("rows-entering"));
  }

  const total = state.employeeTotal;
  const firstRecord = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const lastRecord = Math.min(state.page * state.pageSize, total);
  document.querySelector("#resultsSummary").textContent =
    `Showing ${firstRecord}–${lastRecord} of ${total} ${total === 1 ? "employee" : "employees"}`;
  document.querySelector("#pageIndicator").textContent =
    `Page ${state.page} of ${Math.max(1, Math.ceil(total / state.pageSize))}`;
  document.querySelector("#previousPageButton").disabled = state.page <= 1;
  document.querySelector("#nextPageButton").disabled = state.page * state.pageSize >= total;
}

function renderStats() {
  const total = state.employeeTotal;
  const visibleEmployees = state.employees;
  const average = visibleEmployees.length
    ? visibleEmployees.reduce((sum, employee) => sum + Number(employee.salary), 0) / visibleEmployees.length
    : 0;

  document.querySelector("#totalEmployees").textContent = total.toLocaleString();
  document.querySelector("#totalDepartments").textContent = state.departments.length.toLocaleString();
  document.querySelector("#averageSalary").textContent = formatCurrency(average);
}

function renderAnalytics() {
  const analytics = state.analytics;
  if (!analytics) return;

  const departmentCounts = [...analytics.department_counts]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const staffedDepartments = departmentCounts.filter((item) => item.count > 0);
  const largestDepartment = staffedDepartments[0];
  document.querySelector("#analyticsDepartmentTotal").textContent =
    departmentCounts.length.toLocaleString();
  document.querySelector("#staffedDepartmentTotal").textContent =
    staffedDepartments.length.toLocaleString();
  document.querySelector("#largestDepartment").textContent = largestDepartment
    ? `${largestDepartment.label} · ${largestDepartment.count} people`
    : "No teams yet";
  document.querySelector("#departmentChartTotal").textContent =
    `${departmentCounts.reduce((total, item) => total + item.count, 0).toLocaleString()} people`;

  renderBarChart("departmentChart", departmentCounts, (item) => item.count);
  renderPositionChart(analytics.position_counts);
  renderBarChart(
    "salaryChart",
    [...analytics.average_salary_by_department]
      .sort((a, b) => b.average_salary - a.average_salary || a.label.localeCompare(b.label)),
    (item) => item.average_salary,
    formatCurrency,
  );
  renderHireChart(
    analytics.hires_by_month,
    analytics.employees_without_hire_date,
    analytics.total_employees,
  );
}

function renderBarChart(elementId, items, getValue, formatValue = (value) => value.toLocaleString()) {
  const container = document.querySelector(`#${elementId}`);
  if (items.length === 0) {
    container.innerHTML = '<p class="chart-empty">No data available yet.</p>';
    return;
  }

  const maximum = Math.max(...items.map(getValue), 1);
  container.innerHTML = items.map((item) => {
    const value = getValue(item);
    const width = value > 0 ? Math.max((value / maximum) * 100, 3) : 0;
    return `
      <div class="chart-row" role="listitem">
        <div class="chart-row-heading">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(formatValue(value))}</strong>
        </div>
        <div class="chart-track" aria-hidden="true">
          <span class="chart-bar" style="width:${width.toFixed(1)}%"></span>
        </div>
      </div>`;
  }).join("");
}

function renderPositionChart(items) {
  const donut = document.querySelector("#positionDonut");
  const legend = document.querySelector("#positionChart");
  const emptyState = document.querySelector("#positionEmpty");
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const colors = ["#6d5ce8", "#49b58a", "#f0a75c", "#5794d1", "#d97691", "#8d7cba"];
  document.querySelector("#positionTotal").textContent = total.toLocaleString();
  donut.hidden = items.length === 0;
  legend.hidden = items.length === 0;
  emptyState.hidden = items.length > 0;
  if (items.length === 0) {
    donut.style.background = "";
    legend.innerHTML = "";
    return;
  }

  let offset = 0;
  const segments = items.map((item, index) => {
    const end = offset + (item.count / total) * 100;
    const segment = `${colors[index % colors.length]} ${offset.toFixed(2)}% ${end.toFixed(2)}%`;
    offset = end;
    return segment;
  });
  donut.style.background = `conic-gradient(${segments.join(", ")})`;
  donut.setAttribute(
    "aria-label",
    `Employee role distribution: ${items.map((item) => `${item.label}, ${item.count}`).join("; ")}`,
  );
  legend.innerHTML = items.map((item, index) => {
    const share = Math.round((item.count / total) * 100);
    return `
      <li class="position-legend-item">
        <span class="legend-label">
          <span class="legend-dot" style="--legend-color:${colors[index % colors.length]}"></span>
          <span>${escapeHtml(item.label)}</span>
        </span>
        <strong>${item.count.toLocaleString()} <span>${share}%</span></strong>
      </li>`;
  }).join("");
}

function renderHireChart(items, missingHireDates, totalEmployees) {
  const container = document.querySelector("#hireDateChart");
  if (items.length === 0) {
    const emptyMessage = totalEmployees === 0
      ? "Add employees to start tracking hiring activity."
      : `${missingHireDates.toLocaleString()} of ${totalEmployees.toLocaleString()} employee records are missing a hire date.`;
    container.innerHTML = `
      <div class="hire-empty">
        <span class="hire-empty-icon" aria-hidden="true">▦</span>
        <strong>${totalEmployees === 0 ? "No employee records yet" : "Hire dates needed"}</strong>
        <span>${escapeHtml(emptyMessage)}</span>
        <a class="hire-empty-link" href="#employeeDirectory">${totalEmployees === 0 ? "Go to team directory" : "Update employee records"} <span aria-hidden="true">→</span></a>
      </div>`;
    container.setAttribute("aria-label", emptyMessage);
    return;
  }

  const countsByMonth = new Map(items.map((item) => [item.label, item.count]));
  const currentDate = new Date();
  const months = Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(Date.UTC(
      currentDate.getFullYear(),
      currentDate.getMonth() - 11 + index,
      1,
    ));
    const key = monthDate.toISOString().slice(0, 7);
    return {
      label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(monthDate),
      fullLabel: new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(monthDate),
      count: countsByMonth.get(key) ?? 0,
    };
  });
  const maximum = Math.max(...months.map((month) => month.count), 1);
  const total = months.reduce((sum, month) => sum + month.count, 0);
  container.setAttribute("aria-label", `${total} hires in the last 12 months`);
  container.innerHTML = months.map((month) => {
    const height = month.count ? Math.max((month.count / maximum) * 100, 5) : 2;
    return `
      <div class="hire-column" aria-hidden="true">
        <span class="hire-count">${month.count || ""}</span>
        <span class="hire-bar-wrap"><span class="hire-bar" style="height:${height}%"></span></span>
        <span class="hire-month" title="${month.fullLabel}">${month.label}</span>
      </div>`;
  }).join("");
}

function renderEmployeeRow(employee) {
  const color = AVATAR_COLORS[employee.id % AVATAR_COLORS.length];
  const initials = employee.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const department = employee.department?.name ?? "Unassigned";
  const status = employee.employment_status ?? "Active";
  const statusClass = {
    "Active": "active",
    "On leave": "on-leave",
    "Inactive": "inactive",
  }[status] ?? "inactive";

  return `
    <tr>
      <td>
        <div class="employee-cell">
          <span class="employee-avatar" style="background:${color[0]};color:${color[1]}">${escapeHtml(initials)}</span>
          <span class="employee-copy">
            <strong>${escapeHtml(employee.name)}</strong>
            <span>Employee #${employee.id}</span>
          </span>
        </div>
      </td>
      <td><span class="department-pill">${escapeHtml(department)}</span></td>
      <td><span class="department-pill">${escapeHtml(employee.position)}</span></td>
      <td>${escapeHtml(employee.email)}</td>
      <td>${escapeHtml(employee.phone || "—")}</td>
      <td>${escapeHtml(formatDate(employee.hire_date))}</td>
      <td><span class="status-pill status-${statusClass}">${escapeHtml(status)}</span></td>

      <td class="salary-cell">${formatCurrency(employee.salary)}</td>
      <td>
        <div class="row-actions">
          <button class="row-action" type="button" data-action="edit" data-id="${employee.id}" aria-label="Edit ${escapeHtml(employee.name)}" title="Edit employee">✎</button>
          <button class="row-action delete" type="button" data-action="delete" data-id="${employee.id}" aria-label="Remove ${escapeHtml(employee.name)}" title="Remove employee">⌫</button>
        </div>
      </td>
    </tr>`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function showTableMessage(message) {
  elements.rows.innerHTML = `<tr><td class="table-message" colspan="10">${escapeHtml(message)}</td></tr>`;
}

function showToast(message, isError = false) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3500);
}

function openEmployeeDialog(employee = null) {
  elements.employeeForm.reset();
  elements.employeeError.textContent = "";
  document.querySelector("#employeeId").value = employee?.id ?? "";
  document.querySelector("#employeeName").value = employee?.name ?? "";
  document.querySelector("#employeeEmail").value = employee?.email ?? "";
  document.querySelector("#employeePhone").value = employee?.phone ?? "";
  document.querySelector("#employeeHireDate").value = employee?.hire_date ?? "";
  document.querySelector("#employeeSalary").value = employee?.salary ?? "";
  elements.employeePosition.value = employee?.position ?? "Junior";
  document.querySelector("#employeeStatus").value = employee?.employment_status ?? "Active";
  // document.querySelector("#employeeManager").value = employee?.manager ?? "";
  document.querySelector("#employeeDepartment").value = employee?.department?.id ?? "";
  document.querySelector("#employeeDialogTitle").textContent = employee ? "Edit employee" : "Add an employee";
  document.querySelector("#saveEmployeeButton").textContent = employee ? "Save changes" : "Add employee";
  elements.employeeDialog.showModal();
}

document.querySelector("#addEmployeeButton").addEventListener("click", () => openEmployeeDialog());
document.querySelector("#addDepartmentButton").addEventListener("click", () => {
  elements.departmentForm.reset();
  elements.departmentError.textContent = "";
  elements.departmentDialog.showModal();
});

const navigationLinks = document.querySelectorAll(".sidebar nav .nav-item");

function updateActiveNavigation() {
  const activeHash = window.location.hash === "#employeeDirectory"
    ? "#employees"
    : window.location.hash || "#employees";
  for (const link of navigationLinks) {
    const isActive = link.getAttribute("href") === activeHash;
    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

for (const link of navigationLinks) {
  link.addEventListener("click", () => {
    for (const item of navigationLinks) {
      item.classList.toggle("active", item === link);
    }
  });
}

window.addEventListener("hashchange", updateActiveNavigation);
updateActiveNavigation();

for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", () => button.closest("dialog").close());
}

for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

elements.search.addEventListener("input", () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    state.page = 1;
    loadDashboard();
  }, 250);
});
elements.departmentFilter.addEventListener("change", () => {
  state.page = 1;
  loadDashboard();
});
elements.sort.addEventListener("change", () => {
  state.page = 1;
  loadDashboard();
});
elements.clearSearch.addEventListener("click", () => {
  window.clearTimeout(state.searchTimer);
  elements.search.value = "";
  elements.search.focus();
  state.page = 1;
  loadDashboard();
});

document.querySelector("#previousPageButton").addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    loadDashboard();
  }
});

document.querySelector("#nextPageButton").addEventListener("click", () => {
  if (state.page * state.pageSize < state.employeeTotal) {
    state.page += 1;
    loadDashboard();
  }
});

document.addEventListener("keydown", (event) => {
  const isTyping = event.target instanceof HTMLElement
    && (event.target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName));
  if (!isTyping && event.key === "/") {
    event.preventDefault();
    elements.search.focus();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
  }
});

elements.rows.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const employee = state.employees.find((item) => item.id === Number(button.dataset.id));
  if (!employee) return;

  if (button.dataset.action === "edit") {
    openEmployeeDialog(employee);
  } else {
    state.pendingDelete = employee;
    document.querySelector("#confirmDeleteContext").textContent = "TEAM DIRECTORY";
    document.querySelector("#confirmDeleteTitle").textContent = "Remove employee?";
    document.querySelector("#confirmDeleteMessage").textContent =
      `Remove ${employee.name} from your employee directory? This action cannot be undone.`;
    document.querySelector("#confirmDeleteButton").textContent = "Remove employee";
    elements.confirmDeleteDialog.showModal();
  }
});

elements.employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.employeeError.textContent = "";
  const employeeId = document.querySelector("#employeeId").value;
  const employee = {
    name: document.querySelector("#employeeName").value.trim(),
    email: document.querySelector("#employeeEmail").value.trim(),
    phone: document.querySelector("#employeePhone").value.trim() || null,
    hire_date: document.querySelector("#employeeHireDate").value || null,
    salary: Number(document.querySelector("#employeeSalary").value),
    position: elements.employeePosition.value,
    employment_status: document.querySelector("#employeeStatus").value,
    // manager: document.querySelector("#employeeManager").value.trim() || null,
    department_id: Number(document.querySelector("#employeeDepartment").value),
  };
  const saveButton = document.querySelector("#saveEmployeeButton");
  saveButton.disabled = true;

  try {
    await request(employeeId ? `/employees/${employeeId}` : "/employees", {
      method: employeeId ? "PUT" : "POST",
      body: JSON.stringify(employee),
    });
    elements.employeeDialog.close();
    await loadDashboard();
    showToast(employeeId ? "Employee details updated." : "Employee added to the directory.");
  } catch (error) {
    elements.employeeError.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

elements.departmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.departmentError.textContent = "";
  const saveButton = document.querySelector("#saveDepartmentButton");
  saveButton.disabled = true;

  try {
    const department = await request("/departments", {
      method: "POST",
      body: JSON.stringify({ name: document.querySelector("#departmentName").value.trim() }),
    });
    state.departments.push(department);
    state.departments.sort((first, second) => first.name.localeCompare(second.name));
    populateDepartmentControls();
    renderDashboard();
    document.querySelector("#employeeDepartment").value = String(department.id);
    elements.departmentDialog.close();
    showToast("Department added.");
  } catch (error) {
    elements.departmentError.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

document.querySelector("#confirmDeleteButton").addEventListener("click", async () => {
  if (!state.pendingDelete) return;

  const employee = state.pendingDelete;
  const button = document.querySelector("#confirmDeleteButton");
  button.disabled = true;
  try {
    await request(`/employees/${employee.id}`, {
      method: "DELETE",
    });
    elements.confirmDeleteDialog.close();
    state.pendingDelete = null;
    await loadDashboard();
    showToast("Employee removed.");
  } catch (error) {
    document.querySelector("#confirmDeleteMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

loadDashboard();
