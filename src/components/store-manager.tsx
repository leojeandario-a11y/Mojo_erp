"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/lib/auth";
import { hasEntityPermission } from "@/lib/permissions";

type StoreProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category_id: string | null;
  category: string | null;
  supplier_id: string | null;
  supplier: string | null;
  exhibitor_id: string | null;
  exhibitor: string | null;
  purchase_price: string;
  sale_price: string;
  price_currency: "HTG" | "USD";
  min_stock: number;
  image_path: string | null;
  status: string;
  quantity: string;
  is_low: boolean;
};
type StoreAccount = { id: string; name: string; account_type: string; currency: string; cash_ceiling: string | null; cash_variance_tolerance: string | null };
type CashSession = { account_id: string; status: "open" | "closed" | null; session_id: string | null; opening_count: string | null };
type Category = { id: string; name: string; parent_id: string | null; is_active: boolean };
type SaleItem = { sku: string; name: string; quantity: string; unitPrice: string; lineTotal: string };
type StoreSale = {
  id: string;
  receipt_number: string;
  sold_at: string;
  currency: string;
  subtotal: string;
  discount: string;
  total: string;
  status: string;
  cashier: string;
  items: Array<{ name: string; sku: string; quantity: string; lineTotal: string }>;
};
type StockLocation = { id: string; name: string; is_default: boolean };
type CountLine = { product_id: string; sku: string; name: string; expected_qty: string; counted_qty: string };
type Inventory = { id: string; location_id: string; location: string; counted_on: string; status: string; variance_count: number; product_count: number };
type StockMovement = {
  id: string; product: string; sku: string; location: string; movement_type: string; quantity: string;
  unit_cost: string | null; unit_cost_currency: string | null; reference: string | null; note: string;
  occurred_at: string; created_by: string | null;
};
type Exhibitor = {
  id: string; name: string; contact_name: string | null; email: string | null; phone: string | null;
  space_label: string | null; rent_amount: string; rent_currency: string | null; rent_period: string | null;
  commission_pct: string; commission_basis: "gross_sales" | "net_after_discounts"; status: string;
};
type Statement = {
  id: string; exhibitor_id: string; exhibitor: string; period_start: string; period_end: string;
  sales_total_usd: string; commission_usd: string; rent_usd: string; net_due_to_exhibitor_usd: string;
  status: string; commission_basis: string; paid_to_exhibitor_usd: string; paid_by_exhibitor_usd: string;
};
type StorePayload = {
  store: { id: string; name: string };
  permissions: Record<string, boolean>;
  categories: Category[];
  products: StoreProduct[];
  locations: StockLocation[];
  suppliers: Array<{ id: string; name: string }>;
  accounts: StoreAccount[];
  customers: Array<{ id: string; name: string }>;
  exchangeRateToHtg: string | null;
  sales: StoreSale[];
  metrics: { sales_today: number; revenue_today_usd: string };
  discountLimits: Array<{ role_id: string; code: string; name: string; max_percent: string }>;
  myMaxDiscountPercent: string;
  cashSessions: CashSession[];
  exhibitors: Exhibitor[];
  statements?: Statement[];
  businessDate: string;
};
type CartLine = { productId: string; quantity: string };
type SalePayload = {
  offlineSaleId: string;
  locationId: string;
  currency: "HTG" | "USD";
  customerId: string | null;
  discount: string;
  paymentMethod: "cash" | "card" | "mobile_money" | "bank_transfer";
  accountId: string;
  tenderedAmount: string;
  items: Array<{ productId: string; quantity: string }>;
};
type PendingSale = { id: string; payload: SalePayload; queuedAt: string };

const translations = {
  fr: {
    title: "MOJO Store", subtitle: "Catalogue, stocks, caisse et partenaires réunis dans un espace opérationnel.",
    overview: "Vue d’ensemble", products: "Produits", stock: "Stocks & inventaire", pos: "Point de vente",
    sales: "Ventes", exhibitors: "Exposants", reports: "Rapports", todaySales: "Ventes du jour",
    revenue: "Chiffre d’affaires", productsCount: "Produits actifs", lowStock: "Sous le seuil",
    loading: "Chargement…", retry: "Réessayer", readOnly: "Consultation seule", search: "Rechercher un produit",
    category: "Catégorie", allCategories: "Toutes les catégories", sku: "Référence SKU", barcode: "Code-barres",
    name: "Nom du produit", supplier: "Fournisseur", exhibitor: "Exposant", purchasePrice: "Prix d’achat",
    salePrice: "Prix de vente", currency: "Devise", minimumStock: "Seuil d’alerte", status: "Statut",
    active: "Actif", inactive: "Inactif", createProduct: "Ajouter le produit", saveProduct: "Enregistrer les modifications",
    edit: "Modifier", productImage: "Image du produit (PNG, JPEG ou WebP)", categoryName: "Nom de la catégorie",
    addCategory: "Créer une catégorie", categories: "Catégories", activate: "Activer", deactivate: "Archiver",
    noProducts: "Aucun produit ne correspond à la recherche.", importCsv: "Importer un CSV",
    csvHelp: "Colonnes obligatoires : sku, name, sale_price, price_currency. Maximum 1 000 produits.",
    exportCsv: "Exporter le catalogue CSV", inventory: "Inventaire", startInventory: "Démarrer un comptage",
    location: "Emplacement", date: "Date", count: "Comptage", closeInventory: "Clôturer et ajuster le stock",
    saveCount: "Enregistrer le comptage", countedQuantity: "Quantité comptée", expectedQuantity: "Attendu",
    variance: "Écarts", adjustmentReason: "Motif de l’ajustement", reasonRequired: "Motif obligatoire pour clôturer.",
    stockMovement: "Mouvement de stock", movementType: "Type de mouvement", quantity: "Quantité",
    movementHistory: "Historique des mouvements", noMovements: "Aucun mouvement de stock pour le moment.",
    entry: "Entrée", exit: "Sortie", loss: "Perte", adjustment: "Ajustement signé",
    movementNote: "Note / motif", recordMovement: "Enregistrer le mouvement", unitCost: "Coût unitaire",
    noLocation: "Aucun emplacement Store n’est configuré.", noAccount: "Aucun compte financier n’est configuré pour MOJO Store. Les ventes resteront désactivées jusqu’à la création d’un compte Store dans Finance.",
    openCash: "Ouvrir la caisse", openingCount: "Fond compté à l’ouverture", openSession: "Ouvrir la session",
    openSessionRequired: "Une session de caisse ouverte est requise pour le paiement en espèces.",
    productsInCart: "Articles dans le panier", emptyCart: "Ajoutez des produits au panier pour commencer.",
    addToCart: "Ajouter", subtotal: "Sous-total", discount: "Remise", total: "Total",
    roleDiscount: "Remise maximale de votre rôle", customer: "Client (facultatif)", noCustomer: "Vente comptoir",
    paymentMethod: "Mode de paiement", cash: "Espèces", card: "Carte", mobileMoney: "Monnaie mobile",
    bankTransfer: "Virement", paymentAccount: "Compte de paiement", tendered: "Montant reçu",
    completeSale: "Encaisser et imprimer le reçu", noAccountsForCurrency: "Aucun compte Store actif dans cette devise.",
    scanner: "Scanner un code-barres", cameraUnavailable: "Caméra ou détecteur de code-barres indisponible. Saisissez le code manuellement.",
    stopScanner: "Arrêter le scanner", queuedOffline: "Vente mise en file d’attente hors ligne.",
    pendingSync: "Ventes hors ligne en attente", syncNow: "Synchroniser maintenant",
    receipt: "Reçu", print: "Imprimer le reçu", cashier: "Caissier", payment: "Paiement",
    noSales: "Aucune vente sur cette période.", saleHistory: "Historique des ventes",
    returnSale: "Retour complet", voidSale: "Annuler la vente", confirmReturn: "Confirmer le retour complet",
    confirmVoid: "Confirmer l’annulation", returnReason: "Motif du retour / de l’annulation",
    refundAccount: "Compte de remboursement", receiptNumber: "Numéro du reçu d’origine",
    unusedConfirmation: "Je confirme que les articles retournés sont inutilisés.",
    returnPolicyNote: "Retour sous 7 jours calendaires (jour d’achat inclus), sur présentation du reçu. Articles inutilisés uniquement; remboursement au mode de paiement initial.",
    fullReturnNote: "L’annulation complète remet tous les articles en stock et crée l’écriture compensatoire.",
    createExhibitor: "Ajouter un exposant", exhibitorName: "Nom de l’exposant", contactName: "Personne à contacter",
    email: "Courriel", phone: "Téléphone", space: "Espace / emplacement", rent: "Loyer",
    rentPeriod: "Périodicité du loyer", weekly: "Hebdomadaire", monthly: "Mensuel", oneTime: "Unique",
    commission: "Commission (%)", commissionBasis: "Base de commission", grossSales: "Ventes brutes",
    afterDiscounts: "Après remises", generateStatements: "Générer les relevés hebdomadaires",
    statementMonday: "Lundi de début de semaine", validateStatement: "Valider le relevé",
    statement: "Relevé", period: "Période", commissionAmount: "Commission", rentAmount: "Loyer",
    balanceDue: "Solde net dû à l’exposant", collect: "Encaisser / régler", account: "Compte",
    statementStatus: "Statut du relevé", open: "Ouvert", validated: "Validé", settled: "Réglé",
    negativeBalance: "Solde négatif : l’exposant doit ce montant au Store.",
    noExhibitors: "Aucun exposant n’est configuré.", noStatements: "Aucun relevé hebdomadaire pour le moment.",
    reportIntro: "État opérationnel du catalogue, des stocks et des ventes.",
    requestFailed: "La requête a échoué.", saved: "Enregistrement effectué.", noRate: "Taux USD/HTG indisponible.",
    closedInventory: "Clôturé", cancel: "Annuler", change: "Monnaie rendue",
  },
  ht: {
    title: "MOJO Store", subtitle: "Katalòg, estòk, kès ak patnè yo nan menm espas operasyonèl la.",
    overview: "Apèsi", products: "Pwodwi", stock: "Estòk ak envantè", pos: "Pwen vant",
    sales: "Vant", exhibitors: "Ekspozan", reports: "Rapò", todaySales: "Vant jodi a",
    revenue: "Revni", productsCount: "Pwodwi aktif", lowStock: "Anba limit",
    loading: "Ap chaje…", retry: "Eseye ankò", readOnly: "Konsiltasyon sèlman", search: "Chèche pwodwi",
    category: "Kategori", allCategories: "Tout kategori yo", sku: "Referans SKU", barcode: "Kòd-bar",
    name: "Non pwodwi a", supplier: "Founisè", exhibitor: "Ekspozan", purchasePrice: "Pri acha",
    salePrice: "Pri vant", currency: "Lajan", minimumStock: "Limit alèt", status: "Estati",
    active: "Aktif", inactive: "Inaktif", createProduct: "Ajoute pwodwi", saveProduct: "Anrejistre chanjman yo",
    edit: "Modifye", productImage: "Imaj pwodwi a (PNG, JPEG oswa WebP)", categoryName: "Non kategori a",
    addCategory: "Kreye kategori", categories: "Kategori yo", activate: "Aktive", deactivate: "Achive",
    noProducts: "Pa gen pwodwi ki koresponn ak rechèch la.", importCsv: "Enpòte CSV",
    csvHelp: "Kolòn obligatwa yo: sku, name, sale_price, price_currency. Maksimòm 1 000 pwodwi.",
    exportCsv: "Ekspòte katalòg CSV", inventory: "Envantè", startInventory: "Kòmanse konte",
    location: "Kote", date: "Dat", count: "Konte", closeInventory: "Fèmen epi ajiste estòk la",
    saveCount: "Anrejistre konte a", countedQuantity: "Kantite konte", expectedQuantity: "Atandi",
    variance: "Diferans", adjustmentReason: "Rezon ajisteman an", reasonRequired: "Rezon obligatwa pou fèmen.",
    stockMovement: "Mouvman estòk", movementType: "Kalite mouvman", quantity: "Kantite",
    movementHistory: "Istwa mouvman yo", noMovements: "Pa gen mouvman estòk pou kounye a.",
    entry: "Antre", exit: "Sòti", loss: "Pèt", adjustment: "Ajisteman siyen",
    movementNote: "Nòt / rezon", recordMovement: "Anrejistre mouvman an", unitCost: "Pri pa inite",
    noLocation: "Pa gen kote MOJO Store ki konfigire.", noAccount: "Pa gen kont finansye pou MOJO Store. Vant yo ap rete dezaktive jiskaske yo kreye yon kont Store nan Finans.",
    openCash: "Louvri kès la", openingCount: "Kantite lajan nan ouvèti", openSession: "Louvri sesyon an",
    openSessionRequired: "Yon sesyon kès ouvè obligatwa pou peman kach.",
    productsInCart: "Atik nan panyen an", emptyCart: "Ajoute pwodwi nan panyen an pou kòmanse.",
    addToCart: "Ajoute", subtotal: "Sou-total", discount: "Rabè", total: "Total",
    roleDiscount: "Rabè maksimòm wòl ou a", customer: "Kliyan (opsyonèl)", noCustomer: "Vant dirèk",
    paymentMethod: "Mwayen peman", cash: "Kach", card: "Kat", mobileMoney: "Lajan mobil",
    bankTransfer: "Transfè", paymentAccount: "Kont peman", tendered: "Kantite resevwa",
    completeSale: "Resevwa peman epi enprime resi", noAccountsForCurrency: "Pa gen kont Store aktif nan lajan sa a.",
    scanner: "Eskane kòd-bar la", cameraUnavailable: "Kamera oswa detektè a pa disponib. Antre kòd la manyèlman.",
    stopScanner: "Sispann eskanè a", queuedOffline: "Vant lan mete nan keu pandan rezo a pa disponib.",
    pendingSync: "Vant offline k ap tann", syncNow: "Senkronize kounye a",
    receipt: "Resi", print: "Enprime resi a", cashier: "Kesye", payment: "Peman",
    noSales: "Pa gen vant nan peryòd sa a.", saleHistory: "Istwa vant",
    returnSale: "Retounen tout", voidSale: "Anile vant lan", confirmReturn: "Konfime retou konplè a",
    confirmVoid: "Konfime anilasyon an", returnReason: "Rezon retou / anilasyon an",
    refundAccount: "Kont ranbousman", receiptNumber: "Nimewo resi orijinal la",
    unusedConfirmation: "Mwen konfime atik yo pa t itilize.",
    returnPolicyNote: "Retou nan 7 jou kalandriye (jou acha a konte), avèk resi a. Se sèlman atik ki pa itilize; ranbousman an fèt nan mòd peman orijinal la.",
    fullReturnNote: "Anilasyon an remete tout atik yo nan estòk epi kreye ekriti konpansasyon an.",
    createExhibitor: "Ajoute ekspozan", exhibitorName: "Non ekspozan an", contactName: "Moun pou kontakte",
    email: "Imèl", phone: "Telefòn", space: "Espas / kote", rent: "Lwaye",
    rentPeriod: "Peryòd lwaye a", weekly: "Chak semèn", monthly: "Chak mwa", oneTime: "Yon sèl fwa",
    commission: "Komisyon (%)", commissionBasis: "Baz komisyon an", grossSales: "Vant brit",
    afterDiscounts: "Apre rabè", generateStatements: "Jenere rapò chak semèn",
    statementMonday: "Lendi kòmansman semèn nan", validateStatement: "Valide rapò a",
    statement: "Rapò", period: "Peryòd", commissionAmount: "Komisyon", rentAmount: "Lwaye",
    balanceDue: "Balans nèt pou peye ekspozan an", collect: "Resevwa / regle", account: "Kont",
    statementStatus: "Estati rapò a", open: "Ouvè", validated: "Valide", settled: "Regle",
    negativeBalance: "Balans negatif: ekspozan an dwe kantite sa a bay Store la.",
    noExhibitors: "Pa gen ekspozan ki konfigire.", noStatements: "Pa gen rapò chak semèn pou kounye a.",
    reportIntro: "Eta operasyonèl katalòg, estòk ak vant yo.",
    requestFailed: "Demann nan pa reyisi.", saved: "Anrejistreman fèt.", noRate: "To USD/HTG pa disponib.",
    closedInventory: "Fèmen", cancel: "Anile", change: "Monnen pou remèt",
  },
  en: {
    title: "MOJO Store", subtitle: "Catalog, inventory, checkout, and partners in one operational workspace.",
    overview: "Overview", products: "Products", stock: "Stock & inventory", pos: "Point of sale",
    sales: "Sales", exhibitors: "Exhibitors", reports: "Reports", todaySales: "Sales today",
    revenue: "Revenue", productsCount: "Active products", lowStock: "Below threshold",
    loading: "Loading…", retry: "Retry", readOnly: "Read only", search: "Search products",
    category: "Category", allCategories: "All categories", sku: "SKU", barcode: "Barcode",
    name: "Product name", supplier: "Supplier", exhibitor: "Exhibitor", purchasePrice: "Purchase price",
    salePrice: "Sale price", currency: "Currency", minimumStock: "Alert threshold", status: "Status",
    active: "Active", inactive: "Inactive", createProduct: "Add product", saveProduct: "Save changes",
    edit: "Edit", productImage: "Product image (PNG, JPEG, or WebP)", categoryName: "Category name",
    addCategory: "Create category", categories: "Categories", activate: "Activate", deactivate: "Archive",
    noProducts: "No products match this search.", importCsv: "Import CSV",
    csvHelp: "Required columns: sku, name, sale_price, price_currency. Maximum 1,000 products.",
    exportCsv: "Export catalog CSV", inventory: "Inventory", startInventory: "Start a count",
    location: "Location", date: "Date", count: "Count", closeInventory: "Close and adjust stock",
    saveCount: "Save count", countedQuantity: "Counted quantity", expectedQuantity: "Expected",
    variance: "Variances", adjustmentReason: "Adjustment reason", reasonRequired: "A reason is required to close.",
    stockMovement: "Stock movement", movementType: "Movement type", quantity: "Quantity",
    movementHistory: "Movement history", noMovements: "No stock movements yet.",
    entry: "Entry", exit: "Exit", loss: "Loss", adjustment: "Signed adjustment",
    movementNote: "Note / reason", recordMovement: "Record movement", unitCost: "Unit cost",
    noLocation: "No MOJO Store location is configured.", noAccount: "No financial account is configured for MOJO Store. Sales remain disabled until a Store account is created in Finance.",
    openCash: "Open cash session", openingCount: "Opening count", openSession: "Open session",
    openSessionRequired: "An open cash session is required for cash payments.",
    productsInCart: "Items in cart", emptyCart: "Add products to the cart to begin.",
    addToCart: "Add", subtotal: "Subtotal", discount: "Discount", total: "Total",
    roleDiscount: "Maximum discount for your role", customer: "Customer (optional)", noCustomer: "Walk-in",
    paymentMethod: "Payment method", cash: "Cash", card: "Card", mobileMoney: "Mobile money",
    bankTransfer: "Bank transfer", paymentAccount: "Payment account", tendered: "Amount tendered",
    completeSale: "Complete sale & print receipt", noAccountsForCurrency: "No active Store accounts in this currency.",
    scanner: "Scan barcode", cameraUnavailable: "Camera or barcode detector unavailable. Enter the code manually.",
    stopScanner: "Stop scanner", queuedOffline: "Sale queued while offline.",
    pendingSync: "Offline sales pending", syncNow: "Sync now",
    receipt: "Receipt", print: "Print receipt", cashier: "Cashier", payment: "Payment",
    noSales: "No sales in this period.", saleHistory: "Sales history",
    returnSale: "Full return", voidSale: "Void sale", confirmReturn: "Confirm full return",
    confirmVoid: "Confirm void", returnReason: "Return / void reason",
    refundAccount: "Refund account", receiptNumber: "Original receipt number",
    unusedConfirmation: "I confirm the returned items are unused.",
    returnPolicyNote: "Return within 7 calendar days (purchase day counts), with the receipt. Unused items only; refund to the original payment method.",
    fullReturnNote: "A full void restocks every item and creates the compensating transaction.",
    createExhibitor: "Add exhibitor", exhibitorName: "Exhibitor name", contactName: "Contact name",
    email: "Email", phone: "Phone", space: "Space / location", rent: "Rent",
    rentPeriod: "Rent period", weekly: "Weekly", monthly: "Monthly", oneTime: "One time",
    commission: "Commission (%)", commissionBasis: "Commission basis", grossSales: "Gross sales",
    afterDiscounts: "After discounts", generateStatements: "Generate weekly statements",
    statementMonday: "Week starting Monday", validateStatement: "Validate statement",
    statement: "Statement", period: "Period", commissionAmount: "Commission", rentAmount: "Rent",
    balanceDue: "Net balance due to exhibitor", collect: "Collect / settle", account: "Account",
    statementStatus: "Statement status", open: "Open", validated: "Validated", settled: "Settled",
    negativeBalance: "Negative balance: the exhibitor owes this amount to the Store.",
    noExhibitors: "No exhibitors are configured.", noStatements: "No weekly statements yet.",
    reportIntro: "Operational view of the catalog, inventory, and sales.",
    requestFailed: "The request failed.", saved: "Saved.", noRate: "USD/HTG exchange rate unavailable.",
    closedInventory: "Closed", cancel: "Cancel", change: "Change",
  },
} satisfies Record<Locale, Record<string, string>>;
const localeMessages: Record<Locale, Record<string, string>> = translations;

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null) as T & { error?: string } | null;
  if (!response.ok) throw new Error(body?.error || translations.en.requestFailed);
  return body as T;
}

function openQueue() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("mojo-store-pos", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("pending-sales")) {
        request.result.createObjectStore("pending-sales", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the offline sales queue."));
  });
}

async function readQueue(): Promise<PendingSale[]> {
  const database = await openQueue();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("pending-sales", "readonly");
    const request = transaction.objectStore("pending-sales").getAll() as IDBRequest<PendingSale[]>;
    request.onsuccess = () => { database.close(); resolve(request.result); };
    request.onerror = () => { database.close(); reject(request.error ?? new Error("Unable to read the offline sales queue.")); };
  });
}

async function queueSale(sale: PendingSale) {
  const database = await openQueue();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("pending-sales", "readwrite");
    transaction.objectStore("pending-sales").put(sale);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Unable to save the offline sale.")); };
  });
}

async function removeQueuedSale(id: string) {
  const database = await openQueue();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("pending-sales", "readwrite");
    transaction.objectStore("pending-sales").delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Unable to update the offline sales queue.")); };
  });
}

function BarcodeScanner({ onDetected, onClose, text, stopText }: { onDetected: (value: string) => void; onClose: () => void; text: string; stopText: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onDetected, onClose });
  callbacks.current = { onDetected, onClose };
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let frame = 0;
    type Detector = { detect: (video: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
    type DetectorWindow = Window & { BarcodeDetector?: new (options: { formats: string[] }) => Detector };
    const DetectorApi = (window as DetectorWindow).BarcodeDetector;
    if (!DetectorApi || !navigator.mediaDevices?.getUserMedia) {
      setUnavailable(true);
      return () => undefined;
    }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } }).then(async (camera) => {
      if (!active) {
        camera.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = camera;
      if (videoRef.current) videoRef.current.srcObject = camera;
      const detector = new DetectorApi({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
      const scan = async () => {
        if (!active || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) {
            callbacks.current.onDetected(codes[0].rawValue);
            callbacks.current.onClose();
            return;
          }
        } catch {
          setUnavailable(true);
          return;
        }
        frame = requestAnimationFrame(() => { void scan(); });
      };
      await videoRef.current?.play();
      frame = requestAnimationFrame(() => { void scan(); });
    }).catch(() => setUnavailable(true));
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  return <div className="store-scanner">
    {unavailable ? <p>{text}</p> : <video ref={videoRef} autoPlay muted playsInline aria-label={text} />}
    <button type="button" className="button button-secondary" onClick={onClose}>{stopText}</button>
  </div>;
}

export function StoreManager({ locale, user }: { locale: Locale; user: { id: string; fullName: string; permissions: string[]; entityPermissions: Record<string, string[]> } }) {
  const text = useCallback((key: string) => localeMessages[locale][key] ?? key, [locale]);
  const [data, setData] = useState<StorePayload | null>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingProduct, setEditingProduct] = useState<StoreProduct | null>(null);
  const [barcode, setBarcode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [selectedInventory, setSelectedInventory] = useState("");
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [countReason, setCountReason] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saleCurrency, setSaleCurrency] = useState<"HTG" | "USD">("HTG");
  const [discountAmount, setDiscountAmount] = useState("0.00");
  const [tenderedAmount, setTenderedAmount] = useState("0.00");
  const [paymentMethod, setPaymentMethod] = useState<SalePayload["paymentMethod"]>("cash");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [receipt, setReceipt] = useState<{ sale: { receiptNumber: string; soldAt: string; currency: string; subtotal: string; discount: string; total: string; tendered: string; change: string; paymentMethod: string }; items: SaleItem[] } | null>(null);
  const [pendingSales, setPendingSales] = useState<PendingSale[]>([]);
  const [returnTarget, setReturnTarget] = useState<{ sale: StoreSale; action: "return" | "void" } | null>(null);
  const syncLock = useRef(false);

  const load = useCallback(async () => {
    try {
      const storeData = await requestJson<StorePayload>("/api/v1/store");
      setData(storeData);
      setError("");
      if (storeData.permissions["store.stock.manage"] || storeData.permissions["store.product.read"]) {
        const [counts, stockMovements] = await Promise.all([
          requestJson<{ counts: Inventory[] }>("/api/v1/store/inventory"),
          requestJson<{ movements: StockMovement[] }>("/api/v1/store/stock-movements"),
        ]);
        setInventory(counts.counts);
        setMovements(stockMovements.movements);
      }
      if (storeData.permissions["store.exhibitor.manage"] || storeData.permissions["store.report.read"]
        || storeData.permissions["store.exhibitor.validate"] || storeData.permissions["store.exhibitor.pay"]) {
        const exhibitors = await requestJson<{ exhibitors: Exhibitor[]; statements: Statement[] }>("/api/v1/store/exhibitors");
        setData((current) => current ? { ...current, exhibitors: exhibitors.exhibitors, statements: exhibitors.statements } : current);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    }
  }, [text]);
  useEffect(() => { void load(); }, [load]);

  const syncPending = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.onLine || syncLock.current) return;
    syncLock.current = true;
    try {
      const queued = await readQueue();
      setPendingSales(queued);
      for (const queuedSale of queued) {
        const response = await fetch("/api/v1/store/sales", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(queuedSale.payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          if (response.status < 500) setError(body?.error || text("requestFailed"));
          break;
        }
        await removeQueuedSale(queuedSale.id);
        setPendingSales((current) => current.filter(({ id }) => id !== queuedSale.id));
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      syncLock.current = false;
    }
  }, [load, text]);
  useEffect(() => {
    void readQueue().then(setPendingSales).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : text("requestFailed")));
    const sync = () => { void syncPending(); };
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [syncPending, text]);

  const permission = useCallback((code: string) => !!data && hasEntityPermission(
    { permissions: user.permissions, entityPermissions: user.entityPermissions },
    code,
    data.store.id,
  ), [data, user.entityPermissions, user.permissions]);
  const canManageProducts = permission("store.product.manage");
  const canManageStock = permission("store.stock.manage");
  const canSell = permission("store.pos.sell");
  const canManageExhibitors = permission("store.exhibitor.manage");
  const canReadReports = permission("store.report.read");
  const visibleTabs = useMemo(() => [
    ["overview", "overview"],
    ...(permission("store.product.read") || canManageProducts ? [["products", "products"]] : []),
    ...(permission("store.product.read") || canManageStock ? [["stock", "stock"]] : []),
    ...(canSell ? [["pos", "pos"]] : []),
    ...(canSell || permission("store.product.read") || permission("store.pos.return") || permission("store.pos.void") ? [["sales", "sales"]] : []),
    ...(canManageExhibitors || permission("store.exhibitor.validate") || permission("store.exhibitor.pay") ? [["exhibitors", "exhibitors"]] : []),
    ...(canReadReports ? [["reports", "reports"]] : []),
  ], [canManageExhibitors, canManageProducts, canManageStock, canReadReports, canSell, permission]);
  const products = data?.products ?? [];
  const filteredProducts = products.filter((product) =>
    (!categoryFilter || product.category_id === categoryFilter)
    && `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const activeProducts = products.filter(({ status }) => status === "active");
  const lowProducts = products.filter(({ is_low, status }) => is_low && status === "active");
  const accountsForSale = (data?.accounts ?? []).filter((account) => account.currency === saleCurrency
    && (paymentMethod === "cash" ? account.account_type === "cash"
      : paymentMethod === "mobile_money" ? account.account_type === "mobile_money"
        : account.account_type === "bank" || account.account_type === "other"));
  const selectedAccount = accountsForSale.find(({ id }) => id === selectedAccountId) ?? accountsForSale[0];
  const hasOpenCashSession = !!selectedAccount && data?.cashSessions.some(
    (session) => session.account_id === selectedAccount.id && session.status === "open",
  );
  const cartTotal = cart.reduce((sum, line) => {
    const product = products.find(({ id }) => id === line.productId);
    if (!product) return sum;
    const rate = Number(data?.exchangeRateToHtg);
    if (product.price_currency !== saleCurrency && !(rate > 0)) return sum;
    const unitPrice = product.price_currency === saleCurrency
      ? Number(product.sale_price)
      : product.price_currency === "USD" ? Number(product.sale_price) * rate : Number(product.sale_price) / rate;
    return sum + unitPrice * Number(line.quantity || 0);
  }, 0);
  const canPriceCart = cart.every((line) => {
    const product = products.find(({ id }) => id === line.productId);
    return !product || product.price_currency === saleCurrency || Number(data?.exchangeRateToHtg) > 0;
  });
  const discountLimit = Math.min(100, Number(data?.myMaxDiscountPercent ?? 0));
  const saleTotal = Math.max(0, cartTotal - Number(discountAmount || 0));
  const reportStatements = data?.statements ?? [];

  useEffect(() => setTenderedAmount(saleTotal.toFixed(2)), [saleTotal]);
  useEffect(() => setSelectedAccountId(accountsForSale[0]?.id ?? ""), [data?.accounts, paymentMethod, saleCurrency]);

  async function mutate(url: string, method: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      await requestJson(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setNotice(text("saved"));
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      sku: values.get("sku"), barcode: barcode || null, name: values.get("name"),
      categoryId: values.get("categoryId") || null, supplierId: values.get("supplierId") || null,
      exhibitorId: values.get("exhibitorId") || null, purchasePrice: values.get("purchasePrice"),
      salePrice: values.get("salePrice"), priceCurrency: values.get("priceCurrency"),
      minStock: Number(values.get("minStock") || 0), isActive: values.get("isActive") === "on",
    };
    setBusy(true); setError("");
    try {
      const saved = editingProduct
        ? await requestJson<{ success: boolean }>(`/api/v1/store/products/${editingProduct.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
        }).then(() => ({ id: editingProduct.id }))
        : await requestJson<{ id: string }>("/api/v1/store/products", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
        });
      const image = values.get("image");
      if (image instanceof File && image.size) {
        const formData = new FormData(); formData.set("file", image);
        await requestJson(`/api/v1/store/products/${saved.id}/image`, { method: "POST", body: formData });
      }
      setEditingProduct(null); setBarcode(""); form.reset(); setNotice(text("saved")); await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally { setBusy(false); }
  }

  async function submitCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/store/products/import", { method: "POST", body: form });
      const body = await response.json().catch(() => null) as { error?: string; imported?: number } | null;
      if (!response.ok) throw new Error(body?.error || text("requestFailed"));
      setNotice(`${body?.imported ?? 0} ${text("products").toLocaleLowerCase()}`); formElement.reset(); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : text("requestFailed")); }
    finally { setBusy(false); }
  }

  async function createCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const success = await mutate("/api/v1/store/inventory", "POST", {
      locationId: values.get("locationId"), countedOn: values.get("countedOn"),
    });
    if (success) {
      const refreshed = await requestJson<{ counts: Inventory[] }>("/api/v1/store/inventory");
      setInventory(refreshed.counts);
      const latest = refreshed.counts.find(({ status }) => status === "open");
      if (latest) await selectInventory(latest.id);
    }
  }

  async function selectInventory(id: string) {
    try {
      const result = await requestJson<{ lines: CountLine[] }>(`/api/v1/store/inventory/${id}`);
      setSelectedInventory(id); setCountLines(result.lines);
    } catch (cause) { setError(cause instanceof Error ? cause.message : text("requestFailed")); }
  }

  async function saveInventory(action: "save" | "close") {
    if (!selectedInventory) return;
    const success = await mutate(`/api/v1/store/inventory/${selectedInventory}`, "PATCH", {
      action, reason: countReason || undefined,
      lines: countLines.map(({ product_id, counted_qty }) => ({ productId: product_id, countedQuantity: counted_qty })),
    });
    if (success && action === "close") {
      setSelectedInventory(""); setCountLines([]); setCountReason("");
      const refreshed = await requestJson<{ counts: Inventory[] }>("/api/v1/store/inventory");
      setInventory(refreshed.counts);
    }
  }

  async function openCashSession(event: FormEvent<HTMLFormElement>, accountId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(event.currentTarget);
    const success = await mutate("/api/v1/finance/cash-sessions", "POST", {
      action: "open", accountId, date: data?.businessDate,
      countedAmount: form.get("countedAmount"),
    });
    if (success) formElement.reset();
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !cart.length) {
      setError(text("emptyCart"));
      return;
    }
    const values = new FormData(event.currentTarget);
    const payload: SalePayload = {
      offlineSaleId: crypto.randomUUID(), locationId: String(values.get("locationId")),
      currency: saleCurrency, customerId: String(values.get("customerId") || "") || null,
      discount: String(values.get("discount") || "0"), paymentMethod,
      accountId: String(values.get("accountId")), tenderedAmount: String(values.get("tenderedAmount") || "0"),
      items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
    };
    setBusy(true); setError("");
    try {
      if (!navigator.onLine) {
        const queued = { id: payload.offlineSaleId, payload, queuedAt: new Date().toISOString() };
        await queueSale(queued); setPendingSales((current) => [...current, queued]);
        setNotice(text("queuedOffline")); setCart([]); return;
      }
      const response = await fetch("/api/v1/store/sales", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as {
        error?: string;
        sale?: { receiptNumber: string; soldAt?: string; currency: string; subtotal: string; discount: string; total: string; tendered: string; change: string; paymentMethod?: string };
        items?: SaleItem[];
      } | null;
      if (!response.ok && response.status < 500) throw new Error(body?.error || text("requestFailed"));
      if (!response.ok || !body?.sale) {
        const queued = { id: payload.offlineSaleId, payload, queuedAt: new Date().toISOString() };
        await queueSale(queued); setPendingSales((current) => [...current, queued]);
        setNotice(text("queuedOffline")); setCart([]); return;
      }
      setReceipt({
        sale: {
          ...body.sale,
          soldAt: body.sale.soldAt ?? new Date().toISOString(),
          paymentMethod: body.sale.paymentMethod ?? payload.paymentMethod,
        },
        items: body.items ?? [],
      });
      setCart([]); setDiscountAmount("0.00"); setNotice(text("saved")); await load();
    } catch (cause) {
      if (cause instanceof TypeError) {
        const queued = { id: payload.offlineSaleId, payload, queuedAt: new Date().toISOString() };
        try {
          await queueSale(queued); setPendingSales((current) => [...current, queued]);
          setNotice(text("queuedOffline")); setCart([]);
        } catch (queueError) { setError(queueError instanceof Error ? queueError.message : text("requestFailed")); }
      } else setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally { setBusy(false); }
  }

  async function submitReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!returnTarget) return;
    const values = new FormData(event.currentTarget);
    const payload = returnTarget.action === "return"
      ? {
          action: returnTarget.action,
          receiptNumber: values.get("receiptNumber"),
          conditionConfirmed: values.get("conditionConfirmed") === "on",
          reason: values.get("reason"),
        }
      : {
          action: returnTarget.action,
          accountId: values.get("accountId"),
          reason: values.get("reason"),
        };
    const success = await mutate(`/api/v1/store/sales/${returnTarget.sale.id}/return`, "POST", {
      ...payload,
    });
    if (success) setReturnTarget(null);
  }

  async function submitExhibitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      name: values.get("name"), contactName: values.get("contactName") || null,
      email: values.get("email") || null, phone: values.get("phone") || null,
      spaceLabel: values.get("spaceLabel") || null, rentAmount: values.get("rentAmount") || "0",
      rentCurrency: values.get("rentCurrency") || null, rentPeriod: values.get("rentPeriod") || null,
      commissionPercent: Number(values.get("commissionPercent") || 0),
      commissionBasis: values.get("commissionBasis"), status: values.get("status"),
    };
    const id = String(values.get("exhibitorId") || "");
    const success = await mutate(id ? `/api/v1/store/exhibitors/${id}` : "/api/v1/store/exhibitors", id ? "PATCH" : "POST", payload);
    if (success) form.reset();
  }

  async function generateStatements(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const success = await mutate("/api/v1/store/exhibitors/statements", "POST", { periodStart: values.get("periodStart") });
    if (success) {
      const result = await requestJson<{ statements: Statement[] }>("/api/v1/store/exhibitors/statements");
      setData((current) => current ? { ...current, statements: result.statements } as StorePayload & { statements: Statement[] } : current);
    }
  }

  async function settleStatement(event: FormEvent<HTMLFormElement>, statement: Statement) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await mutate(`/api/v1/store/exhibitors/statements/${statement.id}/payments`, "POST", {
      accountId: values.get("accountId"), amount: values.get("amount"), method: values.get("method"),
    });
  }

  async function saveDiscountLimit(event: FormEvent<HTMLFormElement>, roleId: string) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await mutate("/api/v1/store/discount-limits", "PUT", {
      roleId,
      maxPercent: Number(values.get("maxPercent")),
    });
  }

  if (!data) return <section className="store-shell"><header className="operations-header"><div><span className="eyebrow">MOJO STORE</span><h1>{text("title")}</h1><p>{text("subtitle")}</p></div></header>{error ? <div className="store-alert store-alert-error" role="alert">{error}<button type="button" onClick={() => void load()}>{text("retry")}</button></div> : <p>{text("loading")}</p>}</section>;

  return <section className="store-shell">
    <header className="operations-header store-header">
      <div><span className="eyebrow">MOJO STORE · {data.store.name}</span><h1>{text("title")}</h1><p>{text("subtitle")}</p></div>
      {!canManageProducts && !canManageStock && !canSell && !canManageExhibitors && <span className="operations-access-badge">{text("readOnly")}</span>}
    </header>
    <nav className="operations-tabs" aria-label={text("title")}>
      {visibleTabs.map(([id, label]) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{text(label)}</button>)}
    </nav>
    {error && <p className="store-alert store-alert-error" role="alert">{error}</p>}
    {notice && <p className="store-alert store-alert-success" role="status">{notice}</p>}
    <div className="operations-metrics">
      <article><span>{text("todaySales")}</span><strong>{data.metrics.sales_today}</strong></article>
      <article><span>{text("revenue")}</span><strong>{Number(data.metrics.revenue_today_usd).toLocaleString(locale)} USD</strong></article>
      <article><span>{text("lowStock")}</span><strong>{lowProducts.length}</strong></article>
    </div>

    {tab === "overview" && <div className="store-overview-grid">
      <section className="operations-panel"><h3>{text("reportIntro")}</h3>
        <div className="store-summary-list">
          <div><span>{text("productsCount")}</span><strong>{activeProducts.length}</strong></div>
          <div><span>{text("lowStock")}</span><strong className={lowProducts.length ? "store-warning-text" : ""}>{lowProducts.length}</strong></div>
          <div><span>{text("todaySales")}</span><strong>{data.metrics.sales_today}</strong></div>
          <div><span>{text("revenue")}</span><strong>{Number(data.metrics.revenue_today_usd).toLocaleString(locale)} USD</strong></div>
        </div>
      </section>
      <section className="operations-panel"><div className="operations-panel-heading"><h3>{text("lowStock")}</h3><span className="operations-count">{lowProducts.length}</span></div>
        {lowProducts.length ? <ul className="store-low-stock">{lowProducts.map((product) => <li key={product.id}><span>{product.name}<small>{product.sku}</small></span><strong>{product.quantity} / {product.min_stock}</strong></li>)}</ul> : <p className="store-muted">{text("noProducts")}</p>}
      </section>
      {permission("store.pos.configure") && <section className="operations-panel"><h3>{text("roleDiscount")}</h3>
        <div className="store-discount-limits">{data.discountLimits.map((limit) => <form key={limit.role_id} onSubmit={(event) => void saveDiscountLimit(event, limit.role_id)}>
          <label>{limit.name}<input name="maxPercent" type="number" min="0" max="100" step="0.01" defaultValue={limit.max_percent} /></label>
          <button className="button button-secondary">{text("saveProduct")}</button>
        </form>)}</div>
      </section>}
      {pendingSales.length > 0 && <section className="operations-panel store-pending-sync"><h3>{text("pendingSync")}</h3><strong>{pendingSales.length}</strong><button className="operations-button" onClick={() => void syncPending()}>{text("syncNow")}</button></section>}
    </div>}

    {tab === "products" && <>
      {canManageProducts && <form className="operations-panel operations-form store-product-form" onSubmit={submitProduct} key={editingProduct?.id ?? "new"}>
        <h3>{editingProduct ? text("edit") : text("createProduct")}</h3>
        <label>{text("sku")}<input name="sku" required maxLength={80} defaultValue={editingProduct?.sku ?? ""} /></label>
        <label>{text("barcode")}<div className="store-barcode-field"><input name="barcode" value={barcode} onChange={(event) => setBarcode(event.target.value)} maxLength={120} /><button type="button" className="button button-secondary" onClick={() => setScannerOpen(true)}>{text("scanner")}</button></div></label>
        <label>{text("name")}<input name="name" required minLength={2} defaultValue={editingProduct?.name ?? ""} /></label>
        <label>{text("category")}<select name="categoryId" defaultValue={editingProduct?.category_id ?? ""}><option value="">—</option>{data.categories.filter(({ is_active }) => is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{text("supplier")}<select name="supplierId" defaultValue={editingProduct?.supplier_id ?? ""}><option value="">—</option>{data.suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{text("exhibitor")}<select name="exhibitorId" defaultValue={editingProduct?.exhibitor_id ?? ""}><option value="">—</option>{data.exhibitors?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{text("purchasePrice")}<input name="purchasePrice" type="number" min="0" step="0.01" required defaultValue={editingProduct?.purchase_price ?? "0"} /></label>
        <label>{text("salePrice")}<input name="salePrice" type="number" min="0" step="0.01" required defaultValue={editingProduct?.sale_price ?? ""} /></label>
        <label>{text("currency")}<select name="priceCurrency" defaultValue={editingProduct?.price_currency ?? "HTG"}><option>HTG</option><option>USD</option></select></label>
        <label>{text("minimumStock")}<input name="minStock" type="number" min="0" step="1" defaultValue={editingProduct?.min_stock ?? 0} /></label>
        <label>{text("productImage")}<input name="image" type="file" accept="image/png,image/jpeg,image/webp" /></label>
        {editingProduct && <label className="store-check-label"><span>{text("active")}</span><input name="isActive" type="checkbox" defaultChecked={editingProduct.status === "active"} /></label>}
        {!editingProduct && <input type="hidden" name="isActive" value="on" />}
        <div className="store-form-actions"><button className="operations-button" disabled={busy}>{editingProduct ? text("saveProduct") : text("createProduct")}</button>{editingProduct && <button type="button" className="button button-secondary" onClick={() => setEditingProduct(null)}>{text("cancel")}</button>}</div>
      </form>}
      {canManageProducts && <div className="store-catalog-tools">
        <form className="operations-panel operations-form" onSubmit={async (event) => {
          event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
          const ok = await mutate("/api/v1/store/categories", "POST", { name: values.get("name"), parentId: null });
          if (ok) form.reset();
        }}><h3>{text("categories")}</h3><label>{text("categoryName")}<input name="name" required minLength={2} /></label><button className="operations-button">{text("addCategory")}</button>
          <ul className="store-category-list">{data.categories.map((item) => <li key={item.id}><span>{item.name}</span><button type="button" className="button button-secondary" onClick={() => void mutate(`/api/v1/store/categories/${item.id}`, "PATCH", { name: item.name, isActive: !item.is_active })}>{text(item.is_active ? "deactivate" : "activate")}</button></li>)}</ul>
        </form>
        <form className="operations-panel store-import-form" onSubmit={submitCsv}><h3>{text("importCsv")}</h3><p>{text("csvHelp")}</p><input name="file" type="file" accept=".csv,text/csv" required /><button className="operations-button" disabled={busy}>{text("importCsv")}</button></form>
      </div>}
      <section className="operations-panel store-product-list">
        <div className="operations-panel-heading"><h3>{text("products")}</h3>{canReadReports && <a className="button button-secondary" href="/api/v1/store?format=csv">{text("exportCsv")}</a>}</div>
        <div className="store-product-filters"><input aria-label={text("search")} placeholder={text("search")} value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label={text("category")} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">{text("allCategories")}</option>{data.categories.filter(({ is_active }) => is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="store-product-grid">{filteredProducts.map((product) => <article className="store-product-card" key={product.id}>
          <div className="store-product-image">{product.image_path ? <Image src={`/api/v1/store/products/${product.id}/image`} alt="" width={64} height={64} unoptimized /> : <span>▤</span>}</div>
          <div className="store-product-main"><strong>{product.name}</strong><small>{product.sku} {product.barcode && `· ${product.barcode}`}</small><span>{product.category || "—"} · {product.quantity} {text("quantity")}</span></div>
          <strong className="store-product-price">{Number(product.sale_price).toLocaleString(locale)} {product.price_currency}</strong>
          {product.is_low && <span className="store-low-badge">{text("lowStock")}</span>}
          {canManageProducts && <button type="button" className="button button-secondary" onClick={() => { setEditingProduct(product); setBarcode(product.barcode ?? ""); }}>{text("edit")}</button>}
        </article>)}{filteredProducts.length === 0 && <p className="store-muted">{text("noProducts")}</p>}</div>
      </section>
    </>}

    {tab === "stock" && <>
      {canManageStock && <section className="store-stock-tools">
        <form className="operations-panel operations-form" onSubmit={async (event) => {
          event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
          const ok = await mutate("/api/v1/store/stock-movements", "POST", {
            productId: values.get("productId"), locationId: values.get("locationId"),
            type: values.get("type"), quantity: values.get("quantity"), unitCost: values.get("unitCost") || null,
            currency: values.get("unitCost") ? values.get("currency") : null, reference: values.get("reference") || null,
            note: values.get("note"), date: values.get("date") ? new Date(String(values.get("date"))).toISOString() : undefined,
          });
          if (ok) form.reset();
        }}><h3>{text("stockMovement")}</h3>
          <label>{text("name")}<select name="productId" required>{activeProducts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
          <label>{text("location")}<select name="locationId" required>{data.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{text("movementType")}<select name="type"><option value="entry">{text("entry")}</option><option value="exit">{text("exit")}</option><option value="loss">{text("loss")}</option><option value="adjustment">{text("adjustment")}</option></select></label>
          <label>{text("quantity")}<input name="quantity" type="number" step="0.001" required /></label>
          <label>{text("unitCost")}<input name="unitCost" type="number" min="0" step="0.01" /></label><label>{text("currency")}<select name="currency"><option>HTG</option><option>USD</option></select></label>
          <label>{text("date")}<input name="date" type="datetime-local" /></label><label>{text("sku")}<input name="reference" maxLength={120} /></label>
          <label className="store-form-wide">{text("movementNote")}<input name="note" required minLength={2} maxLength={500} /></label>
          <button className="operations-button" disabled={!data.locations.length || !activeProducts.length}>{text("recordMovement")}</button>
        </form>
        <form className="operations-panel operations-form" onSubmit={createCount}><h3>{text("startInventory")}</h3>
          <label>{text("location")}<select name="locationId" required>{data.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>{text("date")}<input name="countedOn" type="date" required defaultValue={data.businessDate} /></label>
          <button className="operations-button" disabled={!data.locations.length}>{text("startInventory")}</button>
        </form>
      </section>}
      {!data.locations.length && <p className="store-alert store-alert-warning">{text("noLocation")}</p>}
      <section className="operations-panel store-inventory-panel">
        <div className="operations-panel-heading"><h3>{text("inventory")}</h3><span className="operations-count">{inventory.length}</span></div>
        <div className="store-inventory-list">{inventory.map((item) => <button type="button" key={item.id} className={selectedInventory === item.id ? "active" : ""} onClick={() => void selectInventory(item.id)}>
          <span>{item.counted_on} · {item.location}</span><strong>{item.status === "open" ? text("open") : text("closedInventory")}</strong><small>{item.product_count} · {text("variance")}: {item.variance_count}</small>
        </button>)}</div>
        {selectedInventory && <div className="store-count-editor">
          <div className="store-count-table">{countLines.map((line, index) => <div key={line.product_id}><span><strong>{line.name}</strong><small>{line.sku} · {text("expectedQuantity")}: {line.expected_qty}</small></span><input aria-label={`${text("countedQuantity")} ${line.name}`} type="number" min="0" step="0.001" value={line.counted_qty} onChange={(event) => setCountLines((current) => current.map((item, lineIndex) => lineIndex === index ? { ...item, counted_qty: event.target.value } : item))} /></div>)}</div>
          {inventory.find(({ id }) => id === selectedInventory)?.status === "open" && canManageStock && <>
            <label className="store-reason-label">{text("adjustmentReason")}<input value={countReason} onChange={(event) => setCountReason(event.target.value)} minLength={3} maxLength={500} /></label>
            <div className="store-form-actions"><button className="button button-secondary" type="button" onClick={() => void saveInventory("save")}>{text("saveCount")}</button><button className="operations-button" type="button" disabled={countReason.trim().length < 3} onClick={() => void saveInventory("close")}>{text("closeInventory")}</button></div>
          </>}
        </div>}
      </section>
      <section className="operations-panel store-inventory-panel">
        <div className="operations-panel-heading"><h3>{text("movementHistory")}</h3><span className="operations-count">{movements.length}</span></div>
        {!movements.length ? <p className="store-muted">{text("noMovements")}</p> : <div className="store-sales-list">
          {movements.map((movement) => <article key={movement.id}>
            <div className="store-sale-heading"><span><strong>{movement.product} · {movement.sku}</strong><small>{new Date(movement.occurred_at).toLocaleString(locale)} · {movement.location}</small></span><strong>{movement.quantity}</strong></div>
            <div className="store-sale-lines"><span>{movement.movement_type}{movement.reference && ` · ${movement.reference}`}</span><span>{movement.note}</span></div>
            {movement.unit_cost && <small>{text("unitCost")}: {movement.unit_cost} {movement.unit_cost_currency}</small>}
          </article>)}
        </div>}
      </section>
    </>}

    {tab === "pos" && canSell && <div className="store-pos-layout">
      <section className="operations-panel store-pos-catalog">
        <div className="operations-panel-heading"><h3>{text("products")}</h3><button type="button" className="button button-secondary" onClick={() => setScannerOpen(true)}>{text("scanner")}</button></div>
        <input aria-label={text("search")} placeholder={text("search")} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") {
            const product = products.find((item) => item.barcode === query || item.sku.toLocaleLowerCase() === query.toLocaleLowerCase());
            if (product && product.status === "active") setCart((current) => {
              const found = current.find((line) => line.productId === product.id);
              return found ? current.map((line) => line.productId === product.id ? { ...line, quantity: (Number(line.quantity) + 1).toFixed(3) } : line) : [...current, { productId: product.id, quantity: "1.000" }];
            });
            setQuery("");
          }
        }} />
        <div className="store-pos-products">{filteredProducts.filter(({ status }) => status === "active").map((product) => <button type="button" key={product.id} disabled={Number(product.quantity) <= 0} onClick={() => setCart((current) => {
          const found = current.find((line) => line.productId === product.id);
          return found ? current.map((line) => line.productId === product.id ? { ...line, quantity: (Number(line.quantity) + 1).toFixed(3) } : line) : [...current, { productId: product.id, quantity: "1.000" }];
        })}><strong>{product.name}</strong><small>{product.sku} · {product.quantity} {text("quantity")}</small><b>{Number(product.sale_price).toLocaleString(locale)} {product.price_currency}</b></button>)}</div>
      </section>
      <section className="operations-panel store-pos-checkout">
        <div className="operations-panel-heading"><h3>{text("productsInCart")}</h3><span className="operations-count">{cart.length}</span></div>
        {!cart.length && <p className="store-muted">{text("emptyCart")}</p>}
        <div className="store-cart-lines">{cart.map((line) => {
          const product = products.find(({ id }) => id === line.productId);
          if (!product) return null;
          return <div key={line.productId}><span><strong>{product.name}</strong><small>{product.sku}</small></span><input aria-label={`${text("quantity")} ${product.name}`} type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setCart((current) => current.map((item) => item.productId === line.productId ? { ...item, quantity: event.target.value } : item))} /><button type="button" aria-label={text("deactivate")} onClick={() => setCart((current) => current.filter((item) => item.productId !== line.productId))}>×</button></div>;
        })}</div>
        {cart.length > 0 && <>
          <form className="store-checkout-form" onSubmit={checkout}>
            <div className="store-checkout-fields">
            <label>{text("currency")}<select value={saleCurrency} onChange={(event) => setSaleCurrency(event.target.value as "HTG" | "USD")}><option>HTG</option><option>USD</option></select></label>
            <label>{text("customer")}<select name="customerId"><option value="">{text("noCustomer")}</option>{data.customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>{text("discount")}<input name="discount" type="number" min="0" step="0.01" value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} max={cartTotal * discountLimit / 100} /></label>
            <label>{text("paymentMethod")}<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as SalePayload["paymentMethod"])}><option value="cash">{text("cash")}</option><option value="card">{text("card")}</option><option value="mobile_money">{text("mobileMoney")}</option><option value="bank_transfer">{text("bankTransfer")}</option></select></label>
            <label>{text("paymentAccount")}<select name="accountId" required value={selectedAccount?.id ?? ""} onChange={(event) => setSelectedAccountId(event.target.value)}>{accountsForSale.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
            <label>{text("location")}<select name="locationId" required>{data.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label>{text("tendered")}<input name="tenderedAmount" type="number" min="0.01" step="0.01" required value={tenderedAmount} onChange={(event) => setTenderedAmount(event.target.value)} /></label>
            </div>
            <p className="store-discount-help">{text("roleDiscount")}: {discountLimit}%</p>
            <div className="store-cart-totals"><span>{text("subtotal")}</span><strong>{cartTotal.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {saleCurrency}</strong><span>{text("discount")}</span><strong>{Number(discountAmount || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {saleCurrency}</strong><span>{text("total")}</span><strong>{saleTotal.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {saleCurrency}</strong></div>
            {cart.some((line) => products.find(({ id }) => id === line.productId)?.price_currency !== saleCurrency) && !data.exchangeRateToHtg && <p className="store-alert store-alert-warning">{text("noRate")}</p>}
            {accountsForSale.length === 0 ? <p className="store-alert store-alert-warning">{text("noAccount")}<br />{text("noAccountsForCurrency")}</p> :
              <button className="operations-button store-checkout-button" disabled={busy || !canPriceCart || !selectedAccount || (paymentMethod === "cash" && !hasOpenCashSession)}>{text("completeSale")}</button>}
          </form>
          {paymentMethod === "cash" && selectedAccount && !hasOpenCashSession && <form className="store-cash-session" onSubmit={(event) => void openCashSession(event, selectedAccount.id)}>
            <strong>{selectedAccount.name}</strong><span>{text("openSessionRequired")}</span>
            <label>{text("openingCount")}<input name="countedAmount" type="number" min="0" step="0.01" required /></label>
            <button className="button button-secondary">{text("openSession")}</button>
          </form>}
        </>}
      </section>
      {scannerOpen && <BarcodeScanner text={text("cameraUnavailable")} onDetected={(value) => {
        setBarcode(value);
        const product = products.find(({ barcode: productBarcode }) => productBarcode === value);
        if (product) setCart((current) => [...current, { productId: product.id, quantity: "1.000" }]);
      }} onClose={() => setScannerOpen(false)} stopText={text("stopScanner")} />}
    </div>}

    {tab === "sales" && <section className="operations-panel store-sales-panel">
      <h3>{text("saleHistory")}</h3>{!data.sales.length ? <p className="store-muted">{text("noSales")}</p> : <div className="store-sales-list">
        {data.sales.map((sale) => <article key={sale.id}>
          <div className="store-sale-heading"><span><strong>{sale.receipt_number}</strong><small>{new Date(sale.sold_at).toLocaleString(locale)} · {sale.cashier}</small></span><span className={`status-chip status-${sale.status}`}>{sale.status}</span></div>
          <div className="store-sale-lines">{sale.items.map((item, index) => <span key={`${item.sku}-${index}`}>{item.name} · {item.quantity} <b>{Number(item.lineTotal).toLocaleString(locale)} {sale.currency}</b></span>)}</div>
          <div className="store-sale-footer"><strong>{text("total")}: {Number(sale.total).toLocaleString(locale)} {sale.currency}</strong>
            {sale.status === "completed" && (permission("store.pos.return") || permission("store.pos.void")) && <div>
              {permission("store.pos.return") && <button type="button" className="button button-secondary" onClick={() => setReturnTarget({ sale, action: "return" })}>{text("returnSale")}</button>}
              {permission("store.pos.void") && <button type="button" className="button button-secondary" onClick={() => setReturnTarget({ sale, action: "void" })}>{text("voidSale")}</button>}
            </div>}
          </div>
        </article>)}
      </div>}
    </section>}

    {tab === "exhibitors" && <div className="store-exhibitor-layout">
      {canManageExhibitors && <form className="operations-panel operations-form" onSubmit={submitExhibitor}>
        <h3>{text("createExhibitor")}</h3>
        <label>{text("exhibitorName")}<input name="name" required minLength={2} /></label><label>{text("contactName")}<input name="contactName" /></label>
        <label>{text("email")}<input name="email" type="email" /></label><label>{text("phone")}<input name="phone" /></label>
        <label>{text("space")}<input name="spaceLabel" /></label><label>{text("rent")}<input name="rentAmount" type="number" min="0" step="0.01" defaultValue="0" /></label>
        <label>{text("currency")}<select name="rentCurrency"><option>HTG</option><option>USD</option></select></label>
        <label>{text("rentPeriod")}<select name="rentPeriod"><option value="weekly">{text("weekly")}</option><option value="monthly">{text("monthly")}</option><option value="one_time">{text("oneTime")}</option></select></label>
        <label>{text("commission")}<input name="commissionPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" /></label>
        <label>{text("commissionBasis")}<select name="commissionBasis"><option value="gross_sales">{text("grossSales")}</option><option value="net_after_discounts">{text("afterDiscounts")}</option></select></label>
        <label>{text("status")}<select name="status"><option value="active">{text("active")}</option><option value="suspended">{text("inactive")}</option><option value="ended">{text("deactivate")}</option></select></label>
        <button className="operations-button" disabled={busy}>{text("createExhibitor")}</button>
      </form>}
      {canManageExhibitors && <form className="operations-panel operations-form store-statement-generate" onSubmit={generateStatements}>
        <h3>{text("generateStatements")}</h3><label>{text("statementMonday")}<input name="periodStart" type="date" required /></label><button className="operations-button" disabled={busy}>{text("generateStatements")}</button>
        <small>{text("grossSales")} · USD · {text("weekly")}</small>
      </form>}
      <section className="operations-panel"><h3>{text("exhibitors")}</h3>
        {!data.exhibitors?.length ? <p className="store-muted">{text("noExhibitors")}</p> : <div className="store-exhibitor-cards">{data.exhibitors.map((item) => <article key={item.id}>
          <strong>{item.name}</strong><span>{item.space_label || "—"} · {item.status}</span>
          <small>{text("commission")}: {item.commission_pct}% · {item.commission_basis === "gross_sales" ? text("grossSales") : text("afterDiscounts")}</small>
          <small>{text("rent")}: {item.rent_amount} {item.rent_currency || ""} · {item.rent_period || "—"}</small>
        </article>)}</div>}
      </section>
      <section className="operations-panel store-statements-panel"><h3>{text("statement")}</h3>
        {!reportStatements.length ? <p className="store-muted">{text("noStatements")}</p> : reportStatements.map((statement) => {
          const amountDue = Number(statement.net_due_to_exhibitor_usd);
          return <article className="store-statement-card" key={statement.id}>
            <div className="store-sale-heading"><span><strong>{statement.exhibitor}</strong><small>{statement.period_start} — {statement.period_end}</small></span><span className={`status-chip status-${statement.status}`}>{text(statement.status)}</span></div>
            <div className="store-statement-metrics"><span>{text("revenue")}<b>{statement.sales_total_usd} USD</b></span><span>{text("commissionAmount")}<b>{statement.commission_usd} USD</b></span><span>{text("rentAmount")}<b>{statement.rent_usd} USD</b></span><span>{text("balanceDue")}<b className={amountDue < 0 ? "store-negative" : ""}>{statement.net_due_to_exhibitor_usd} USD</b></span></div>
            {amountDue < 0 && <p className="store-negative-note">{text("negativeBalance")}</p>}
            {statement.status === "open" && permission("store.exhibitor.validate") && <button type="button" className="operations-button" onClick={() => void mutate(`/api/v1/store/exhibitors/statements/${statement.id}`, "PATCH", { action: "validate" })}>{text("validateStatement")}</button>}
            {statement.status === "validated" && permission("store.exhibitor.pay") && <form className="store-settlement-form" onSubmit={(event) => void settleStatement(event, statement)}>
              <label>{text("account")}<select name="accountId" required>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
              <label>{text("quantity")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label>{text("paymentMethod")}<select name="method"><option value="cash">{text("cash")}</option><option value="card">{text("card")}</option><option value="mobile_money">{text("mobileMoney")}</option><option value="bank_transfer">{text("bankTransfer")}</option></select></label>
              <button className="operations-button">{text("collect")}</button>
            </form>}
          </article>;
        })}
      </section>
    </div>}

    {tab === "reports" && <div className="store-overview-grid">
      <section className="operations-panel"><h3>{text("reportIntro")}</h3><div className="store-summary-list">
        <div><span>{text("productsCount")}</span><strong>{activeProducts.length}</strong></div>
        <div><span>{text("lowStock")}</span><strong>{lowProducts.length}</strong></div>
        <div><span>{text("todaySales")}</span><strong>{data.metrics.sales_today}</strong></div>
        <div><span>{text("revenue")}</span><strong>{Number(data.metrics.revenue_today_usd).toLocaleString(locale)} USD</strong></div>
      </div><a className="button button-secondary" href="/api/v1/store?format=csv">{text("exportCsv")}</a></section>
    </div>}

    {returnTarget && <div className="store-dialog-backdrop" role="presentation" onClick={() => setReturnTarget(null)}>
      <form className="operations-panel store-return-dialog" onSubmit={submitReturn} onClick={(event) => event.stopPropagation()}>
        <h3>{text(returnTarget.action === "return" ? "confirmReturn" : "confirmVoid")}</h3>
        <p>{text(returnTarget.action === "return" ? "returnPolicyNote" : "fullReturnNote")}</p>
        {returnTarget.action === "return" ? <>
          <label>{text("receiptNumber")}<input name="receiptNumber" autoComplete="off" required maxLength={120} /></label>
          <label className="store-return-confirmation"><input name="conditionConfirmed" type="checkbox" required />{text("unusedConfirmation")}</label>
        </> : <label>{text("refundAccount")}<select name="accountId" required>{data.accounts.filter(({ currency }) => currency === returnTarget.sale.currency).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
        <label>{text("returnReason")}<textarea name="reason" required minLength={3} maxLength={500} rows={3} /></label>
        <div className="store-form-actions"><button className="operations-button" disabled={busy}>{text(returnTarget.action === "return" ? "confirmReturn" : "confirmVoid")}</button><button className="button button-secondary" type="button" onClick={() => setReturnTarget(null)}>{text("cancel")}</button></div>
      </form>
    </div>}
    {receipt && <div className="store-dialog-backdrop store-receipt-backdrop"><section className="operations-panel store-receipt">
      <span className="eyebrow">MoJo PIKtures</span><p>#19 rue magonès, Pétion-Ville · 34 17 1586</p>
      <h2>{text("receipt")}</h2><p>{receipt.sale.receiptNumber}</p>
      <p>{new Date(receipt.sale.soldAt).toLocaleString(locale)} · {text("cashier")}: {user.fullName}</p>
      <div>{receipt.items.map((item, index) => <div key={`${item.sku}-${index}`}><span>{item.name} · {item.quantity} × {item.unitPrice}</span><strong>{item.lineTotal} {receipt.sale.currency}</strong></div>)}</div>
      <p>{text("subtotal")}: {receipt.sale.subtotal} {receipt.sale.currency}</p><p>{text("discount")}: {receipt.sale.discount} {receipt.sale.currency}</p>
      <strong>{text("total")}: {receipt.sale.total} {receipt.sale.currency}</strong><p>{text("payment")}: {text(receipt.sale.paymentMethod === "mobile_money" ? "mobileMoney" : receipt.sale.paymentMethod === "bank_transfer" ? "bankTransfer" : receipt.sale.paymentMethod)} · {receipt.sale.tendered} · {text("change")}: {receipt.sale.change} {receipt.sale.currency}</p>
      <div className="store-form-actions"><button className="operations-button" onClick={() => window.print()}>{text("print")}</button><button className="button button-secondary" onClick={() => setReceipt(null)}>{text("cancel")}</button></div>
    </section></div>}
    {scannerOpen && tab !== "pos" && <BarcodeScanner text={text("cameraUnavailable")} onDetected={(value) => { setBarcode(value); setQuery(value); }} onClose={() => setScannerOpen(false)} stopText={text("stopScanner")} />}
  </section>;
}
