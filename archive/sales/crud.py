def create_sales_transaction(db: Session, sales_data: schemas.SalesHeaderCreate):
    # 1. Create the Header
    new_header = models.SalesHeader(
        date=sales_data.date,
        shift=sales_data.shift,
        register_id=sales_data.register_id,
        location_id=sales_data.location_id,
        cashier_id=sales_data.cashier_id,
        subtotal_amount=sales_data.subtotal_amount,
        total_amount=sales_data.total_amount,

        # Inject the new fields
        transaction_type=sales_data.transaction_type,
        manual_adjustment_amount=sales_data.manual_adjustment_amount,
        adjustment_reason=sales_data.adjustment_reason,
        linked_receipt_id=sales_data.linked_receipt_id
    )
    db.add(new_header)
    db.flush()  # Get the new ID before committing

    # 2. Process Items and Inventory
    for item_data in sales_data.items:
        new_item = models.SalesItem(
            sales_id=new_header.sales_id,
            product_id=item_data.product_id,
            qty=item_data.qty,
            price=item_data.price,
            net_cost=item_data.net_cost
        )
        db.add(new_item)

        # 3. Handle Inventory strictly for physical goods
        product = db.query(Product).filter(Product.product_id == item_data.product_id).first()

        if product and product.is_inventory:
            # If sale: stock - 1. If refund: stock - (-1) = stock + 1. Perfect math!
            product.stock -= item_data.qty

    db.commit()
    db.refresh(new_header)
    return new_header