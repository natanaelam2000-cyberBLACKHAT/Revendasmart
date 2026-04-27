/**
 * Migration helpers for Fase 3 data validation and structure
 * Used for preparing migrations without executing them
 */

interface MigrationStats {
  phase: 'images' | 'products' | 'clients' | 'sales' | 'installments' | 'posts' | 'complete';
  counts: {
    products: number;
    clients: number;
    sales: number;
    installments: number;
    posts: number;
    images: number;
  };
  errors: string[];
  pending: {
    products: string[];
    clients: string[];
    sales: string[];
    installments: string[];
    posts: string[];
    images: string[];
  };
  integrity: {
    orphanedImages: string[];
    brokenProductRefs: string[];
    brokenClientRefs: string[];
    brokenSaleRefs: string[];
    brokenInstallmentRefs: string[];
    duplicateIds: string[];
  };
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate product structure
 */
export function validateProduct(product: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!product.id) errors.push(`Product missing id`);
  if (!product.name) errors.push(`Product ${product.id} missing name`);
  if (typeof product.salePrice !== 'number') errors.push(`Product ${product.id} missing salePrice`);
  if (typeof product.stock !== 'number') warnings.push(`Product ${product.id} missing stock (defaults to 0)`);
  if (!product.category) warnings.push(`Product ${product.id} missing category`);

  // Image validation: either has imageUrl OR imageId pointing to IndexedDB
  if (!product.imageUrl && !product.imageId) {
    warnings.push(`Product ${product.id} has no image`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate client structure
 */
export function validateClient(client: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!client.id) errors.push(`Client missing id`);
  if (!client.name) errors.push(`Client ${client.id} missing name`);
  if (!client.phone) warnings.push(`Client ${client.id} missing phone`);

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate sale structure and references
 */
export function validateSale(
  sale: any,
  products: any[],
  clients: any[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!sale.id) errors.push(`Sale missing id`);
  if (!sale.clientId) errors.push(`Sale ${sale.id} missing clientId`);
  if (!Array.isArray(sale.products)) errors.push(`Sale ${sale.id} missing products array`);
  if (typeof sale.totalPrice !== 'number') errors.push(`Sale ${sale.id} missing totalPrice`);

  // Check client exists
  if (sale.clientId && !clients.find(c => c.id === sale.clientId)) {
    errors.push(`Sale ${sale.id} references unknown clientId: ${sale.clientId}`);
  }

  // Check product refs
  if (Array.isArray(sale.products)) {
    for (const item of sale.products) {
      if (!products.find(p => p.id === item.productId)) {
        errors.push(`Sale ${sale.id} references unknown productId: ${item.productId}`);
      }
    }
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate installment structure and references
 */
export function validateInstallment(
  installment: any,
  sales: any[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!installment.id) errors.push(`Installment missing id`);
  if (!installment.saleId) errors.push(`Installment ${installment.id} missing saleId`);
  if (typeof installment.amount !== 'number') errors.push(`Installment ${installment.id} missing amount`);
  if (!installment.dueDate) errors.push(`Installment ${installment.id} missing dueDate`);

  // Check sale exists
  if (installment.saleId && !sales.find(s => s.id === installment.saleId)) {
    errors.push(`Installment ${installment.id} references unknown saleId: ${installment.saleId}`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Validate scheduled post structure and references
 */
export function validatePost(post: any, products: any[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!post.id) errors.push(`Post missing id`);
  if (!post.productId) errors.push(`Post ${post.id} missing productId`);
  if (!post.content) warnings.push(`Post ${post.id} missing content`);
  if (!post.scheduledDate) errors.push(`Post ${post.id} missing scheduledDate`);

  // Check product exists
  if (post.productId && !products.find(p => p.id === post.productId)) {
    errors.push(`Post ${post.id} references unknown productId: ${post.productId}`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}

/**
 * Check for duplicate IDs across all entities
 */
export function findDuplicateIds(
  products: any[],
  clients: any[],
  sales: any[],
  installments: any[],
  posts: any[]
): string[] {
  const allIds: { [id: string]: number } = {};
  const duplicates: string[] = [];

  for (const item of [...products, ...clients, ...sales, ...installments, ...posts]) {
    if (item.id) {
      allIds[item.id] = (allIds[item.id] || 0) + 1;
    }
  }

  for (const [id, count] of Object.entries(allIds)) {
    if (count > 1) {
      duplicates.push(`ID "${id}" appears ${count} times`);
    }
  }

  return duplicates;
}

/**
 * Check for orphaned images (exist in imageMetadata but not in any product)
 */
export function findOrphanedImages(
  products: any[],
  imageIds: string[]
): string[] {
  const usedImages = new Set<string>();

  for (const product of products) {
    if (product.imageId) {
      usedImages.add(product.imageId);
    }
  }

  return imageIds.filter(id => !usedImages.has(id));
}

/**
 * Generate migration status report (DRY RUN)
 */
export function generateMigrationStatus(
  products: any[],
  clients: any[],
  sales: any[],
  installments: any[],
  posts: any[],
  imageIds: string[]
): MigrationStats {
  const stats: MigrationStats = {
    phase: 'images',
    counts: {
      products: products.length,
      clients: clients.length,
      sales: sales.length,
      installments: installments.length,
      posts: posts.length,
      images: imageIds.length,
    },
    errors: [],
    pending: {
      products: [],
      clients: [],
      sales: [],
      installments: [],
      posts: [],
      images: [],
    },
    integrity: {
      orphanedImages: [],
      brokenProductRefs: [],
      brokenClientRefs: [],
      brokenSaleRefs: [],
      brokenInstallmentRefs: [],
      duplicateIds: [],
    },
  };

  // Validate products
  for (const product of products) {
    const validation = validateProduct(product);
    if (!validation.isValid) {
      stats.pending.products.push(product.id);
      stats.errors.push(`Product ${product.id}: ${validation.errors.join(', ')}`);
    }
  }

  // Validate clients
  for (const client of clients) {
    const validation = validateClient(client);
    if (!validation.isValid) {
      stats.pending.clients.push(client.id);
      stats.errors.push(`Client ${client.id}: ${validation.errors.join(', ')}`);
    }
  }

  // Validate sales
  for (const sale of sales) {
    const validation = validateSale(sale, products, clients);
    if (!validation.isValid) {
      stats.pending.sales.push(sale.id);
      stats.errors.push(`Sale ${sale.id}: ${validation.errors.join(', ')}`);
    }
  }

  // Validate installments
  for (const installment of installments) {
    const validation = validateInstallment(installment, sales);
    if (!validation.isValid) {
      stats.pending.installments.push(installment.id);
      stats.errors.push(`Installment ${installment.id}: ${validation.errors.join(', ')}`);
    }
  }

  // Validate posts
  for (const post of posts) {
    const validation = validatePost(post, products);
    if (!validation.isValid) {
      stats.pending.posts.push(post.id);
      stats.errors.push(`Post ${post.id}: ${validation.errors.join(', ')}`);
    }
  }

  // Check integrity
  stats.integrity.duplicateIds = findDuplicateIds(products, clients, sales, installments, posts);
  stats.integrity.orphanedImages = findOrphanedImages(products, imageIds);

  return stats;
}
