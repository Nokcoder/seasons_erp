# test_scripts/test_master_data.py
import sys
import os
import time  # <-- NEW: Imported time for dynamic data generation

# The Sys-Path Hack
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.append(parent_dir)

from core.database import SessionLocal
from inventory.models import Product, Supplier, ProductCategory, UOM, ProductBarcode, BundleComponent


def run_master_data_test():
    print("🚀 Initiating Dynamic Schema Stress Test...\n")
    session = SessionLocal()

    # NEW: Generate a unique string based on the exact current second
    uid = str(int(time.time()))

    try:
        # --- TEST 1: The Master Data ---
        print("--- 1. Testing Master Data Creation ---")

        new_supplier = Supplier(name=f"Global Kitchen Supplies {uid}", contact_person="Jane Doe")
        # Appending uid to unique constraints!
        new_category = ProductCategory(category_name=f"Cookware-{uid}")
        uom_pc = UOM(uom_code=f"PC-{uid}", uom_name="Piece")
        uom_box = UOM(uom_code=f"BOX-{uid}", uom_name="Box of 10")

        session.add_all([new_supplier, new_category, uom_pc, uom_box])
        session.commit()
        print(f"✅ Supplier, Category, and UOMs created! (UID: {uid})")

        # --- TEST 2: The Physical Product ---
        print("\n--- 2. Testing Product & Foreign Keys ---")
        new_wok = Product(
            pid=f"WOK-PRO-{uid}",  # Unique PID
            sku=f"SKU-WOK-{uid}",  # Unique SKU
            name="Pro Stainless Steel Wok",
            brand="WokMaster",
            price=1500.00,
            cost=800.00,
            supplier_id=new_supplier.supplier_id,
            category_id=new_category.category_id,
            base_uom_id=uom_pc.uom_id
        )
        session.add(new_wok)
        session.commit()
        print(f"✅ Product created and safely linked! (PID: {new_wok.pid})")

        # --- TEST 3: The Barcodes ---
        print("\n--- 3. Testing 1-to-Many Barcodes ---")
        barcode_1 = ProductBarcode(
            product_id=new_wok.product_id,
            barcode=f"12345-{uid}",  # Unique Barcode
            uom_id=uom_pc.uom_id
        )
        barcode_2 = ProductBarcode(
            product_id=new_wok.product_id,
            barcode=f"09876-{uid}",  # Unique Barcode
            uom_id=uom_box.uom_id
        )

        session.add_all([barcode_1, barcode_2])
        session.commit()
        print("✅ 2 distinct Barcodes successfully linked to the Wok!")

        # --- TEST 4: The Bundle (Bill of Materials) ---
        print("\n--- 4. Testing Bundles (Bill of Materials) ---")
        bundle_set = Product(
            pid=f"SET-HOL-{uid}",  # Unique PID
            name="Holiday Wok Gift Set",
            is_bundle=True,
            price=2000.00
        )
        session.add(bundle_set)
        session.commit()

        recipe_item = BundleComponent(
            bundle_id=bundle_set.product_id,
            component_id=new_wok.product_id,
            quantity=1.00
        )
        session.add(recipe_item)
        session.commit()
        print(f"✅ Bundle '{bundle_set.name}' created and linked to physical component '{new_wok.name}'!")

        print("\n🎉 ALL TESTS PASSED! THE SCHEMA IS FLAWLESS.")

    except Exception as e:
        session.rollback()
        print(f"\n❌ ERROR CAUGHT: {str(e)}")

    finally:
        session.close()


if __name__ == "__main__":
    run_master_data_test()