
from sqlalchemy import Column, Date, Integer, String, Float, ForeignKey
from sqlalchemy.orm import relationship

from databased import Base


# Department Table
class Department(Base):
    __tablename__ = "departments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)

    employees = relationship(
        "Employee",
        back_populates="department"
    )


# Employee Table
class Employee(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, nullable=False)
    salary = Column(Float, nullable=False)
    position = Column(String(100), nullable=False, default="Junior")
    phone = Column(String(30), nullable=True)
    hire_date = Column(Date, nullable=True)
    employment_status = Column(
        String(32),
        nullable=False,
        default="Active",
        server_default="Active",
    )
    # manager = Column(String(100), nullable=True)

    department_id = Column(
        Integer,
        ForeignKey("departments.id")
    )

    department = relationship(
        "Department",
        back_populates="employees"
    )
