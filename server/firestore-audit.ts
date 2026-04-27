import { initializeFirebaseAdmin } from "./firebase-admin-init.js";

interface Product {
  id: string;
  name: string;
  salePrice: number;
  costPrice: number;
  stock: number;
}

interface Sale {
  id: string;
  clientId: string;
  totalPrice: number;
  paymentType: string;
  date: string;
  products: any[];
}

interface Client {
  id: string;
  name: string;
  phone: string;
}

interface Installment {
  id: string;
  saleId: string;
  clientId: string;
  amount: number;
  dueDate: string;
  status: string;
}

async function audit() {
  const TARGET_UID = "F1cB0wulSwferWbqLBVJHTlcaLo2";
  
  console.log(`\n🔍 AUDITORIA FIRESTORE - UID: ${TARGET_UID}\n`);

  try {
    await initializeFirebaseAdmin();
    
    const adminModule = await import("firebase-admin");
    const admin = adminModule.default;
    const firestore = admin.firestore();

    // Get Products
    const productsSnap = await firestore
      .collection("users")
      .doc(TARGET_UID)
      .collection("products")
      .get();
    const products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Product[];
    console.log(`✅ Products count: ${products.length}`);

    // Get Sales
    const salesSnap = await firestore
      .collection("users")
      .doc(TARGET_UID)
      .collection("sales")
      .get();
    const sales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Sale[];
    console.log(`✅ Sales count: ${sales.length}`);

    // Get Clients
    const clientsSnap = await firestore
      .collection("users")
      .doc(TARGET_UID)
      .collection("clients")
      .get();
    const clients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Client[];
    console.log(`✅ Clients count: ${clients.length}`);

    // Get Installments
    const installmentsSnap = await firestore
      .collection("users")
      .doc(TARGET_UID)
      .collection("installments")
      .get();
    const installments = installmentsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Installment[];
    console.log(`✅ Installments count: ${installments.length}`);

    // === SAMPLES ===
    console.log(`\n📦 PRODUCTS SAMPLE (top 3):`);
    products.slice(0, 3).forEach(p => {
      console.log(JSON.stringify({
        id: p.id,
        name: p.name,
        salePrice: p.salePrice,
        costPrice: p.costPrice,
        stock: p.stock
      }, null, 2));
    });

    console.log(`\n💰 SALES SAMPLE (top 3):`);
    sales.slice(0, 3).forEach(s => {
      console.log(JSON.stringify({
        id: s.id,
        clientId: s.clientId,
        totalPrice: s.totalPrice,
        paymentType: s.paymentType,
        date: s.date,
        products_count: s.products?.length || 0
      }, null, 2));
    });

    console.log(`\n👥 CLIENTS SAMPLE (top 3):`);
    clients.slice(0, 3).forEach(c => {
      console.log(JSON.stringify({
        id: c.id,
        name: c.name,
        phone: c.phone
      }, null, 2));
    });

    // === CALCULATE METRICS ===
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const currentMonthSales = sales.filter(s => {
      const saleDate = new Date(s.date);
      return saleDate.getMonth() === currentMonth && saleDate.getFullYear() === currentYear;
    });

    const totalRevenueThisMonth = currentMonthSales.reduce((acc, s) => acc + s.totalPrice, 0);

    const totalCostThisMonth = currentMonthSales.reduce((acc, s) => {
      const cost = (s.products || []).reduce((sum, p) => {
        const product = products.find(prod => prod.id === p.productId);
        return sum + (product?.costPrice || 0) * p.quantity;
      }, 0);
      return acc + cost;
    }, 0);

    const profitThisMonth = totalRevenueThisMonth - totalCostThisMonth;

    const totalProductsSoldThisMonth = currentMonthSales.reduce((acc, s) => {
      return acc + (s.products || []).reduce((sum, p) => sum + p.quantity, 0);
    }, 0);

    const activeClientsThisMonth = new Set(currentMonthSales.map(s => s.clientId)).size;

    console.log(`\n📊 DASHBOARD CALCULATIONS (Current Month: ${now.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}):`);
    console.log(`  Vendas registradas: ${currentMonthSales.length}`);
    console.log(`  Receita bruta: R$ ${totalRevenueThisMonth.toFixed(2)}`);
    console.log(`  Custo estimado: R$ ${totalCostThisMonth.toFixed(2)}`);
    console.log(`  Lucro estimado: R$ ${profitThisMonth.toFixed(2)}`);
    console.log(`  Produtos vendidos (qty): ${totalProductsSoldThisMonth}`);
    console.log(`  Clientes ativos: ${activeClientsThisMonth}`);

    console.log(`\n🎯 EXPECTED DASHBOARD VALUES:`);
    console.log(`  Receita: R$ ${totalRevenueThisMonth.toFixed(2)}`);
    console.log(`  Lucro: R$ ${profitThisMonth.toFixed(2)}`);
    console.log(`  Produtos Vendidos: ${totalProductsSoldThisMonth}`);
    console.log(`  Clientes Ativos: ${activeClientsThisMonth}`);

    console.log(`\n✅ Auditoria completada`);

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }

  process.exit(0);
}

audit();
