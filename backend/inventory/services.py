# services/services.py
from decimal import Decimal
from core.database import SessionLocal
from inventory.models import CurrentStock, InventoryLedger, LedgerReason
from sqlalchemy.exc import SQLAlchemyError


def receive_stock(product_id: int, location_id: int, quantity: float, ref_table: str = None,
                  ref_pk: str = None) -> dict:
    """
    Receives new inventory into a specific location.
    Creates a ledger history and updates the live stock count.
    """
    if quantity <= 0:
        return {"success": False, "error": "Receive quantity must be greater than zero."}

    # Safely convert the incoming float to a highly precise Decimal for the database
    safe_qty = Decimal(str(quantity))

    session = SessionLocal()

    try:
        # STEP 1: Write the permanent history in the Ledger
        receipt_log = InventoryLedger(
            product_id=product_id,
            location_id=location_id,
            qty_change=safe_qty,
            reason=LedgerReason.RECEIVE,
            ref_table=ref_table,
            ref_pk=ref_pk
        )
        session.add(receipt_log)

        # STEP 2: Update the live math in Current Stocks
        existing_stock = session.query(CurrentStock).filter_by(
            product_id=product_id,
            location_id=location_id
        ).first()

        new_stock_level = safe_qty

        if existing_stock:
            existing_stock.quantity += safe_qty
            new_stock_level = existing_stock.quantity
        else:
            new_stock_record = CurrentStock(
                product_id=product_id,
                location_id=location_id,
                quantity=safe_qty
            )
            session.add(new_stock_record)

        # STEP 3: Commit both actions atomically
        session.commit()

        # Return a clean dictionary. (Convert Decimal back to float so JSON can read it later)
        return {
            "success": True,
            "message": f"Successfully received {quantity} units.",
            "data": {
                "product_id": product_id,
                "location_id": location_id,
                "new_total_stock": float(new_stock_level)
            }
        }

    except SQLAlchemyError as e:
        session.rollback()
        print(f"Database Error in receive_stock: {str(e)}")
        return {"success": False, "error": "A database error occurred during the transaction."}

    finally:
        session.close()




def transfer_stock(product_id: int, source_location_id: int, destination_location_id: int, quantity: float,
                   ref_table: str = None, ref_pk: str = None) -> dict:
    """
    Moves inventory from one location to another.
    Creates two ledger entries (OUT and IN) and updates both stock records.
    """
    if quantity <= 0:
        return {"success": False, "error": "Transfer quantity must be greater than zero."}

    if source_location_id == destination_location_id:
        return {"success": False, "error": "Source and destination locations cannot be the same."}

    safe_qty = Decimal(str(quantity))
    session = SessionLocal()

    try:
        # STEP 1: Verify the source actually has enough stock to move
        source_stock = session.query(CurrentStock).filter_by(
            product_id=product_id,
            location_id=source_location_id
        ).first()

        if not source_stock or source_stock.quantity < safe_qty:
            return {"success": False, "error": "Insufficient stock at the source location."}

        # STEP 2: Subtract from the Source
        source_stock.quantity -= safe_qty

        # STEP 3: Add to the Destination
        dest_stock = session.query(CurrentStock).filter_by(
            product_id=product_id,
            location_id=destination_location_id
        ).first()

        new_dest_level = safe_qty

        if dest_stock:
            dest_stock.quantity += safe_qty
            new_dest_level = dest_stock.quantity
        else:
            new_dest_record = CurrentStock(
                product_id=product_id,
                location_id=destination_location_id,
                quantity=safe_qty
            )
            session.add(new_dest_record)

            # STEP 4: Write the Double-Entry Ledger History
            ledger_out = InventoryLedger(
                product_id=product_id,
                location_id=source_location_id,
                qty_change=-safe_qty,
                reason=LedgerReason.TRANSFER_OUT,  # <--- CHANGED THIS
                ref_table=ref_table,
                ref_pk=ref_pk
            )

            ledger_in = InventoryLedger(
                product_id=product_id,
                location_id=destination_location_id,
                qty_change=safe_qty,
                reason=LedgerReason.TRANSFER_IN,  # <--- CHANGED THIS
                ref_table=ref_table,
                ref_pk=ref_pk
            )

        session.add(ledger_out)
        session.add(ledger_in)

        # STEP 5: Commit all four actions simultaneously
        session.commit()

        return {
            "success": True,
            "message": f"Successfully transferred {quantity} units.",
            "data": {
                "product_id": product_id,
                "source": {
                    "location_id": source_location_id,
                    "remaining_stock": float(source_stock.quantity)
                },
                "destination": {
                    "location_id": destination_location_id,
                    "new_total_stock": float(new_dest_level)
                }
            }
        }

    except SQLAlchemyError as e:
        session.rollback()
        print(f"Database Error in transfer_stock: {str(e)}")
        return {"success": False, "error": "A database error occurred during the transaction."}

    finally:
        session.close()