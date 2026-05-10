# Seeds/build_warehouse.py
import sys
import os
from decimal import Decimal

# Ensure Python can find your folders
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.database import SessionLocal, engine
from inventory.models import Location, Product, CurrentStock, ProductCategory, Supplier, ProductSupplier

# IMPORT FIX: Grab the User model from wherever you stored it!
# If you left it in inventory/models.py, change this back to `from inventory.models import User`
from auth.models import User

def get_or_create(db, model, defaults=None, **kwargs):
    instance = db.query(model).filter_by(**kwargs).first()
    if instance:
        return instance, False
    params = {**kwargs, **(defaults or {})}
    instance = model(**params)
    db.add(instance)
    db.commit()
    return instance, True

def seed_enterprise_db():
    print("Connecting to the Enterprise Database...")
    db = SessionLocal()

    try:
        # 0. Create Users (CRITICAL for the Transfer Dropdowns to work!)
        print("Seeding Users...")
        admin, _ = get_or_create(db, User, username="admin", defaults={"hashed_password": "fake_hash_for_now", "role": "ADMIN"})
        manager, _ = get_or_create(db, User, username="manager", defaults={"hashed_password": "fake_hash_for_now", "role": "WAREHOUSE_MANAGER"})

        # 1. Create Locations
        print("Seeding Locations...")
        wh_a, _ = get_or_create(db, Location, name="Warehouse A", type="Warehouse")
        showroom, _ = get_or_create(db, Location, name="Main Showroom", type="Retail")

        # 2. Create Categories
        print("Seeding Categories...")
        cookware, _ = get_or_create(db, ProductCategory, category_name="Cookware")
        cutlery, _ = get_or_create(db, ProductCategory, category_name="Cutlery")

        # 3. Create Suppliers
        print("Seeding Suppliers...")
        vendor_1, _ = get_or_create(db, Supplier, name="Global Kitchen Supply", defaults={"payment_terms": "Net 30"})
        vendor_2, _ = get_or_create(db, Supplier, name="Cast Iron Co.", defaults={"payment_terms": "COD"})

        # 4. Ensure Products Exist (FIXED: price -> tag_price & gross_cost)
        print("Seeding Products...")
        wok, wok_created = get_or_create(
            db, Product, pid="WOK-001",
            defaults={
                "sku": "KK-WOK-14",
                "name": "Cast Iron Wok",
                "brand": "KitchenKing",
                "tag_price": Decimal('59.99'),   # <-- FIXED
                "gross_cost": Decimal('25.00')   # <-- FIXED
            }
        )
        knife, knife_created = get_or_create(
            db, Product, pid="KNF-005",
            defaults={
                "sku": "SE-CHEF-8",
                "name": "Chef's Knife",
                "brand": "SharpEdge",
                "tag_price": Decimal('120.00'),
                "gross_cost": Decimal('50.00')
            }
        )

        # Assign categories cleanly
        if cookware not in wok.categories:
            wok.categories.append(cookware)
        if cutlery not in knife.categories:
            knife.categories.append(cutlery)

        # 5. Ensure Vendors are Assigned
        print("Seeding Vendor Sourcing...")
        get_or_create(
            db, ProductSupplier, product_id=wok.product_id, supplier_id=vendor_1.supplier_id,
            defaults={"vendor_cost": Decimal('25.00'), "lead_time_days": 7, "is_primary": True}
        )
        get_or_create(
            db, ProductSupplier, product_id=knife.product_id, supplier_id=vendor_2.supplier_id,
            defaults={"vendor_cost": Decimal('50.00'), "lead_time_days": 14, "is_primary": True}
        )

        # 6. Ensure Stock Exists
        print("Seeding Inventory Levels...")
        get_or_create(
            db, CurrentStock, product_id=wok.product_id, location_id=wh_a.location_id,
            defaults={"quantity": Decimal('20.00')}
        )
        get_or_create(
            db, CurrentStock, product_id=knife.product_id, location_id=wh_a.location_id,
            defaults={"quantity": Decimal('5.00')}
        )

        db.commit()
        print("✅ Success! Verified Users, Locations, Products, Vendors, and Stock.")

    except Exception as e:
        print(f"❌ Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_enterprise_db()