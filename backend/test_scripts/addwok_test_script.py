# addwok_test_script.py
from inventory.services import receive_stock

print("🚀 Firing Service Function...")

# Let's receive 25 more Woks onto Shelf A1
# Product ID 1 (Wok), Location ID 4 (Shelf A1)
response = receive_stock(
    product_id=1,
    location_id=4,
    quantity=25.0,
    ref_table="manual_test",
    ref_pk="test-001"
)

# Print the exact dictionary that your API will eventually send to React
print("\n📦 Response from Backend:")
print(response)