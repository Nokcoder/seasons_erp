# A simple dictionary mapping Roles to an extensive list of Action Tags
ROLE_PERMISSIONS = {
    "ADMIN": [
        "view_inventory", "edit_product", "delete_product",
        "create_transfer", "edit_transfer_header", "process_transfer_instantly"
    ],
    "WAREHOUSE_MANAGER": [
        "view_inventory", "create_transfer", "receive_transfer"
    ],
    "WAREHOUSE_STAFF": [
        "view_inventory", "receive_transfer"
    ]
}