# seed_enterprise.py
from core.database import SessionLocal
from inventory import models
from decimal import Decimal


def seed_database():
    db = SessionLocal()

    try:
        print("Clearing old test data (if any)...")
        # Deleting in reverse order of foreign keys to prevent constraint errors
        db.query(models.CostLayer).delete()
        db.query(models.PriceHistory).delete()
        db.query(models.CurrentStock).delete()
        db.query(models.Product).delete()
        db.query(models.Location).delete()
        db.commit()

        print("1. Building Locations...")
        warehouse = models.Location(name="Warehouse A", type="Warehouse")
        showroom = models.Location(name="Main Showroom", type="Storefront")
        db.add_all([warehouse, showroom])
        db.flush()  # Flushes assign IDs without committing the whole transaction yet

        print("2. Forging 5 Enterprise Products...")
        products = [
            models.Product(
                pid="WOK-001", sku="KK-WOK-14", name="Cast Iron Wok", brand="KitchenKing", variant="14-inch",
                description="Heavy-duty pre-seasoned cast iron wok. Best seller.",
                tag_price=Decimal('59.99'), price_discount=Decimal('0.0000'),  # 0% off
                gross_cost=Decimal('25.00'), cost_discount=Decimal('0.0000')  # 0% off
            ),
            models.Product(
                pid="KNF-005", sku="SE-CHEF-8", name="Chef's Knife", brand="SharpEdge", variant="8-inch Stainless",
                description="Professional grade German steel chef knife.",
                tag_price=Decimal('120.00'), price_discount=Decimal('0.1500'),  # 15% off tag (Sale!)
                gross_cost=Decimal('50.00'), cost_discount=Decimal('0.1000')  # 10% volume discount from supplier
            ),
            models.Product(
                pid="BRD-002", sku="BB-BOARD-L", name="Bamboo Cutting Board", brand="EcoChef", variant="Large",
                description="Sustainable bamboo, reversible with juice groove.",
                tag_price=Decimal('35.00'), price_discount=Decimal('0.0000'),
                gross_cost=Decimal('12.00'), cost_discount=Decimal('0.0000')
            ),
            models.Product(
                pid="SPT-010", sku="OX-SPAT-SIL", name="Silicone Spatula", brand="FlexiGrip", variant="Red",
                description="Heat resistant up to 600F.",
                tag_price=Decimal('14.99'), price_discount=Decimal('0.0000'),
                gross_cost=Decimal('4.50'), cost_discount=Decimal('0.0000')
            ),
            models.Product(
                pid="OVN-001", sku="LC-DUTCH-5", name="Enameled Dutch Oven", brand="Le Cook", variant="5.5 Qt Blue",
                description="Premium cast iron dutch oven. High margin item.",
                tag_price=Decimal('250.00'), price_discount=Decimal('0.0000'),
                gross_cost=Decimal('110.00'), cost_discount=Decimal('0.2000')  # 20% massive wholesale discount
            )
        ]
        db.add_all(products)
        db.flush()

        # Grab the newly created products to attach stock to them
        wok = products[0]
        knife = products[1]
        board = products[2]
        spatula = products[3]
        oven = products[4]

        print("3. Stocking the Shelves (Physical) & Creating Cost Layers (Financial)...")

        # --- THE WOK (Demonstrating FIFO Layers) ---
        # Physically, we have 20 Woks in the Warehouse.
        db.add(models.CurrentStock(product_id=wok.product_id, location_id=warehouse.location_id, quantity=20))
        # Financially, they came from two different shipments!
        db.add(models.CostLayer(
            product_id=wok.product_id, unit_cost=Decimal('20.00'),  # Old cheap shipment
            original_qty=10, remaining_qty=10, ref_table='initial_seed', ref_pk='seed_1'
        ))
        db.add(models.CostLayer(
            product_id=wok.product_id, unit_cost=Decimal('25.00'),  # Newer expensive shipment
            original_qty=10, remaining_qty=10, ref_table='initial_seed', ref_pk='seed_2'
        ))

        # --- THE KNIFE ---
        db.add(models.CurrentStock(product_id=knife.product_id, location_id=showroom.location_id, quantity=5))
        db.add(models.CostLayer(
            product_id=knife.product_id, unit_cost=Decimal('45.00'),  # 50 Gross * 0.90 Discount = 45 Net Cost
            original_qty=5, remaining_qty=5, ref_table='initial_seed'
        ))

        # --- THE CUTTING BOARD ---
        db.add(models.CurrentStock(product_id=board.product_id, location_id=warehouse.location_id, quantity=50))
        db.add(models.CostLayer(
            product_id=board.product_id, unit_cost=Decimal('12.00'),
            original_qty=50, remaining_qty=50, ref_table='initial_seed'
        ))

        # --- THE SPATULA (In two locations) ---
        db.add(models.CurrentStock(product_id=spatula.product_id, location_id=warehouse.location_id, quantity=100))
        db.add(models.CurrentStock(product_id=spatula.product_id, location_id=showroom.location_id, quantity=25))
        db.add(models.CostLayer(
            product_id=spatula.product_id, unit_cost=Decimal('4.50'),
            original_qty=125, remaining_qty=125, ref_table='initial_seed'
            # One big layer covers both physical locations!
        ))

        # --- THE DUTCH OVEN (Out of stock) ---
        # We create the product, but do not add any CurrentStock or CostLayers.
        # It will gracefully show 0 and Unassigned in the UI.

        # --- QUICK CATEGORY INJECTION ---
        print("4. Tagging Categories...")
        cat_cookware = models.ProductCategory(category_name="Cookware")
        cat_tools = models.ProductCategory(category_name="Kitchen Tools")
        db.add_all([cat_cookware, cat_tools])
        db.flush()

        # Link them up
        wok.categories.append(cat_cookware)
        oven.categories.append(cat_cookware)
        knife.categories.append(cat_tools)
        board.categories.append(cat_tools)
        spatula.categories.append(cat_tools)

        db.commit()
        print("\n✅ Enterprise Seeding Complete! The database is locked, loaded, and financially accurate.")

    except Exception as e:
        db.rollback()
        print(f"\n❌ Seeding Failed: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()