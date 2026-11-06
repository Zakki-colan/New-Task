
from pathlib import Path

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import asc, desc, func, inspect, or_, text

from databased import engine, Base, get_db
from models import Employee, Department

from schema import (
    DepartmentCreate,
    DepartmentResponse,
    EmployeeCreate,
    EmployeeUpdate,
    EmployeePatch,
    EmployeeResponse
)


# Create database tables (initial development only)
Base.metadata.create_all(bind=engine)

# Add the position field to databases created before it was introduced.
with engine.begin() as connection:
    employee_columns = {
        column["name"] for column in inspect(connection).get_columns("employees")
    }
    new_employee_columns = {
        "position": "VARCHAR(100) NOT NULL DEFAULT 'Junior'",
        "phone": "VARCHAR(30)",
        "hire_date": "DATE",
        "employment_status": "VARCHAR(32) NOT NULL DEFAULT 'Active'",
        # "manager": "VARCHAR(100)",
    }
    for column_name, column_definition in new_employee_columns.items():
        if column_name not in employee_columns:
            connection.execute(text(
                f"ALTER TABLE employees ADD COLUMN {column_name} {column_definition}"
            ))


app = FastAPI(title="Employee Management API")

BASE_DIR = Path(__file__).resolve().parent
MAX_PAGE_SIZE = 100
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

router = APIRouter()


def ensure_email_available(
    db: Session,
    email: str,
    exclude_employee_id: int | None = None,
) -> None:
    query = db.query(Employee).filter(Employee.email == email)
    if exclude_employee_id is not None:
        query = query.filter(Employee.id != exclude_employee_id)

    if query.first():
        raise HTTPException(status_code=409, detail="Email already in use")


@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(BASE_DIR / "index.html")


# ---------------------------------
# CREATE DEPARTMENT
# ---------------------------------

@router.get("/departments", response_model=list[DepartmentResponse])
def get_departments(db: Session = Depends(get_db)):
    return db.query(Department).order_by(Department.name).all()


@router.post("/departments", response_model=DepartmentResponse, status_code=201)
def create_department(data: DepartmentCreate, db: Session = Depends(get_db)):

    department = Department(name=data.name)

    db.add(department)
    db.commit()
    db.refresh(department)

    return department


# ---------------------------------
# CREATE EMPLOYEE (POST)
# ---------------------------------

@router.post("/employees", response_model=EmployeeResponse, status_code=201)
def create_employee(data: EmployeeCreate, db: Session = Depends(get_db)):

    department = db.query(Department).filter(
        Department.id == data.department_id
    ).first()

    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    ensure_email_available(db, data.email)

    employee = Employee(**data.model_dump())

    db.add(employee)
    db.commit()
    db.refresh(employee)

    return employee


# ---------------------------------
# GET ALL EMPLOYEES
# PAGINATION + FILTER + SORTING
# ---------------------------------

@router.get("/employees", response_model=list[EmployeeResponse])
def get_employees(
    response: Response,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=MAX_PAGE_SIZE),
    department_id: int | None = None,
    min_salary: float | None = None,
    max_salary: float | None = None,
    search: str | None = Query(default=None, max_length=100),
    sort_by: str = "id",
    order: str = "asc",
    db: Session = Depends(get_db)
):

    query = db.query(Employee)

    # Filtering
    if department_id is not None:
        query = query.filter(Employee.department_id == department_id)

    if min_salary is not None:
        query = query.filter(Employee.salary >= min_salary)

    if max_salary is not None:
        query = query.filter(Employee.salary <= max_salary)

    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Employee.name.ilike(search_pattern),
                Employee.email.ilike(search_pattern),
            )
        )

    response.headers["X-Total-Count"] = str(query.order_by(None).count())

    # Sorting
    allowed_sort_fields = {
        "id": Employee.id,
        "name": Employee.name,
        "salary": Employee.salary
    }

    if sort_by not in allowed_sort_fields:
        raise HTTPException(status_code=400, detail="Invalid sort field")

    if order.lower() == "desc":
        query = query.order_by(desc(allowed_sort_fields[sort_by]))
    elif order.lower() == "asc":
        query = query.order_by(asc(allowed_sort_fields[sort_by]))
    else:
        raise HTTPException(status_code=400, detail="Invalid sort order")

    # Pagination
    employees = query.offset(skip).limit(limit).all()

    return employees


# ---------------------------------
# GET EMPLOYEE BY ID
# ---------------------------------

@router.get("/employees/{employee_id}", response_model=EmployeeResponse)
def get_employee(employee_id: int, db: Session = Depends(get_db)):

    employee = db.query(Employee).filter(
        Employee.id == employee_id
    ).first()

    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    return employee


# ---------------------------------
# PUT - FULL UPDATE
# ---------------------------------

@router.put("/employees/{employee_id}", response_model=EmployeeResponse)
def update_employee(
    employee_id: int,
    data: EmployeeUpdate,
    db: Session = Depends(get_db)
):

    employee = db.query(Employee).filter(
        Employee.id == employee_id
    ).first()

    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    department = db.query(Department).filter(
        Department.id == data.department_id
    ).first()

    if not department:
        raise HTTPException(status_code=404, detail="Department not found")

    ensure_email_available(db, data.email, employee_id)

    # for key, value in data.model_dump(exclude_unset=True).items():
    #     if value is None and key not in {"phone", "hire_date", "manager"}:
    #         continue
    #     setattr(employee, key, value)

    db.commit()
    db.refresh(employee)

    return employee


# ---------------------------------
# PATCH - PARTIAL UPDATE
# ---------------------------------

@router.patch("/employees/{employee_id}", response_model=EmployeeResponse)
def patch_employee(
    employee_id: int,
    data: EmployeePatch,
    db: Session = Depends(get_db)
):

    employee = db.query(Employee).filter(
        Employee.id == employee_id
    ).first()

    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    update_data = data.model_dump(exclude_unset=True)

    if any(value is None for value in update_data.values()):
        raise HTTPException(
            status_code=422,
            detail="PATCH fields cannot be null",
        )

    if "email" in update_data:
        ensure_email_available(db, update_data["email"], employee_id)

    if "department_id" in update_data:
        department = db.query(Department).filter(
            Department.id == update_data["department_id"]
        ).first()

        if not department:
            raise HTTPException(status_code=404, detail="Department not found")

    for key, value in update_data.items():
        setattr(employee, key, value)

    db.commit()
    db.refresh(employee)

    return employee


# ---------------------------------
# DELETE EMPLOYEE
# ---------------------------------

@router.delete("/employees/{employee_id}")
def delete_employee(employee_id: int, db: Session = Depends(get_db)):

    employee = db.query(Employee).filter(
        Employee.id == employee_id
    ).first()

    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    db.delete(employee)
    db.commit()

    return {"message": "Employee deleted successfully"}


# ---------------------------------
# SQL JOIN
# ---------------------------------

@router.get("/employees-with-department")
def employees_with_department(db: Session = Depends(get_db)):

    result = db.query(Employee, Department).join(
        Department,
        Employee.department_id == Department.id
    ).all()

    return [
        {
            "id": employee.id,
            "name": employee.name,
            "email": employee.email,
            "salary": employee.salary,
            "position": employee.position,
            "department": department.name
        }
        for employee, department in result
    ]


@router.get("/analytics/employees")
def get_employee_analytics(db: Session = Depends(get_db)):
    total_employees = db.query(func.count(Employee.id)).scalar() or 0
    employees_without_hire_date = db.query(
        func.count(Employee.id)
    ).filter(Employee.hire_date.is_(None)).scalar() or 0

    department_counts = db.query(
        Department.name,
        func.count(Employee.id).label("employee_count"),
    ).outerjoin(
        Employee,
        Employee.department_id == Department.id,
    ).group_by(
        Department.id,
        Department.name,
    ).order_by(Department.name).all()

    position_counts = db.query(
        Employee.position,
        func.count(Employee.id).label("employee_count"),
    ).group_by(Employee.position).order_by(Employee.position).all()

    department_salaries = db.query(
        Department.name,
        func.avg(Employee.salary).label("average_salary"),
    ).join(
        Employee,
        Employee.department_id == Department.id,
    ).group_by(
        Department.id,
        Department.name,
    ).order_by(Department.name).all()

    hires_by_month = {}
    hire_dates = db.query(Employee.hire_date).filter(
        Employee.hire_date.isnot(None)
    ).all()
    for (hire_date,) in hire_dates:
        month = hire_date.strftime("%Y-%m")
        hires_by_month[month] = hires_by_month.get(month, 0) + 1

    return {
        "total_employees": total_employees,
        "employees_without_hire_date": employees_without_hire_date,
        "department_counts": [
            {"label": name, "count": count}
            for name, count in department_counts
        ],
        "position_counts": [
            {"label": position, "count": count}
            for position, count in position_counts
        ],
        "average_salary_by_department": [
            {"label": name, "average_salary": float(average_salary)}
            for name, average_salary in department_salaries
        ],
        "hires_by_month": [
            {"label": month, "count": count}
            for month, count in sorted(hires_by_month.items())
        ],
    }


# Include Router
app.include_router(router)
