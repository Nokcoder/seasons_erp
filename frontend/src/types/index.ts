// frontend/src/types/index.ts

export interface Category {
  category_id: number;
  category_name: string;
}

export interface Product {
  product_id: number;
  pid: string;
  brand: string | null;
  name: string;          
  variant: string | null;
  sku: string | null;
  price: number | null;  
  cost: number | null;   
  categories: Category[]; 
}