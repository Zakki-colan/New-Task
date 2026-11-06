
from datetime import date
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Literal, Optional


Position = Literal[
    "Junior",
    "Senior",
    "Team Leader",
    "Project Coordinator (PC)",
    "Manager",
]

EmploymentStatus = Literal["Active", "On leave", "Inactive"]


# Department Schema
class DepartmentCreate(BaseModel):
    name: str


class DepartmentResponse(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


# Employee Create Schema
class EmployeeCreate(BaseModel):
    name: str
    email: EmailStr
    salary: float = Field(gt=0)
    position: Position
    department_id: int
    phone: Optional[str] = Field(default=None, max_length=30)
    hire_date: Optional[date] = None
    employment_status: EmploymentStatus = "Active"
    # manager: Optional[str] = Field(default=None, max_length=100)


# Employee Update Schema (PUT)
class EmployeeUpdate(BaseModel):
    name: str
    email: EmailStr
    salary: float = Field(gt=0)
    position: Optional[Position] = None
    department_id: int
    phone: Optional[str] = Field(default=None, max_length=30)
    hire_date: Optional[date] = None
    employment_status: Optional[EmploymentStatus] = None
    # manager: Optional[str] = Field(default=None, max_length=100)


# Employee Partial Update Schema (PATCH)
class EmployeePatch(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    salary: Optional[float] = Field(default=None, gt=0)
    position: Optional[Position] = None
    department_id: Optional[int] = None
    phone: Optional[str] = Field(default=None, max_length=30)
    hire_date: Optional[date] = None
    employment_status: Optional[EmploymentStatus] = None
    # manager: Optional[str] = Field(default=None, max_length=100)


# Employee Response Schema
class EmployeeResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    salary: float
    position: str
    department: DepartmentResponse
    phone: Optional[str]
    hire_date: Optional[date]
    employment_status: EmploymentStatus
    # manager: Optional[str]

    model_config = ConfigDict(from_attributes=True)
