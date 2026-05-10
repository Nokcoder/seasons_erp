# transfer_service.py

import sys
import os

# 1. Get the absolute path of the folder this script is in
current_dir = os.path.dirname(os.path.abspath(__file__))
# 2. Get the path of the parent directory (your main project folder)
parent_dir = os.path.dirname(current_dir)
# 3. Add that parent directory to Python's brain
sys.path.append(parent_dir)


from inventory.services import receive_stock, transfer_stock

print("--- TEST 1: RECEIVE STOCK ---")
print("🚀 Firing Receive Service...")

# 1. Receive 25 Woks onto Shelf A1 (Location ID: 4)
receive_response = receive_stock(
    product_id=1,
    location_id=4,
    quantity=25.0,
    ref_table="manual_test",
    ref_pk="test-002"
)
print("📦 Receive Response:")
print(receive_response)

print("\n" + "="*50 + "\n")

print("--- TEST 2: TRANSFER STOCK ---")
print("🚚 Firing Transfer Service...")

# 2. Move 20 Woks from Shelf A1 (Location ID: 4) to Receiving Dock (Location ID: 1)
transfer_response = transfer_stock(
    product_id=1,
    source_location_id=4,
    destination_location_id=1,
    quantity=20.0,
    ref_table="manual_transfer",
    ref_pk="transfer-001"
)
print("📦 Transfer Response:")
print(transfer_response)