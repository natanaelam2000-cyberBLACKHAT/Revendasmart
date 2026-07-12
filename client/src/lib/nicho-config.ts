/**
 * NICHO-CONFIG — Fonte única de configuração por tipo de negócio
 *
 * Usado por: add-product, onboarding, settings, catalog
 *
 * Regras:
 * - Categorias são isoladas por nicho (sem mistura)
 * - Marcas pré-definidas são sugestões por nicho, sempre com opção livre
 * - Origem é separada de marca
 * - Campos extras são específicos por nicho (sem "validade" em roupas, etc)
 */

export const NICHO_IDS = [
  'Cosméticos & Perfumes',
  'Roupas',
  'Acessórios',
  'Alimentos/Doces',
  'Geral',
] as const;

export type NichoId = typeof NICHO_IDS[number];

export interface ExtraFieldConfig {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'date' | 'number' | 'select';
  halfWidth?: boolean;
  /** Opções para tipo 'select' */
  options?: string[];
}

export interface NichoConfig {
  id: NichoId;
  label: string;
  desc: string;
  iconName: 'Store' | 'Shirt' | 'Watch' | 'Cookie' | 'Box';
  categories: string[];
  /**
   * Se definido: mostra lista de sugestões + permite digitação livre (modo híbrido)
   * Se undefined: campo texto livre sem sugestões
   */
  predefinedBrands?: string[];
  brandLabel: string;
  brandPlaceholder: string;
  originOptions: string[];
  originPlaceholder: string;
  extraFields: ExtraFieldConfig[];
  /** Filtros disponíveis no catálogo para este nicho */
  catalogFilters: string[];
  productNamePlaceholder: string;
  descriptionPlaceholder: string;
}

export const NICHO_CONFIG: Record<NichoId, NichoConfig> = {
  'Cosméticos & Perfumes': {
    id: 'Cosméticos & Perfumes',
    label: 'Cosméticos & Perfumes',
    desc: 'Natura, Boticário, Mary Kay...',
    iconName: 'Store',
    categories: [
      'Perfumes',
      'Hidratantes',
      'Maquiagem',
      'Batons',
      'Base',
      'Corretivo',
      'Máscara',
      'Cuidados com a Pele',
      'Cuidados com o Cabelo',
      'Shampoo',
      'Condicionador',
      'Sabonetes',
      'Kits',
      'Promoções',
      'Outros',
    ],
    predefinedBrands: [
      'Natura',
      'O Boticário',
      'Avon',
      'Eudora',
      'Mary Kay',
      'Quem Disse Berenice',
      "L'Oréal",
      'Nivea',
      'La Roche-Posay',
      'Vichy',
      'CeraVe',
      'Neutrogena',
      'Dove',
      'Granado',
      'Phebo',
      'Jequiti',
      'Hinode',
      'O.U.i',
      'Quem Disse, Berenice?',
      'MAC',
      'Maybelline',
      'Ruby Rose',
      'Vult',
      'Dailus',
      'Bruna Tavares',
      'Salon Line',
      'Skala',
      'Elseve',
      'Pantene',
      'Garnier',
      'Bio-Oil',
      'Bioderma',
      'ISDIN',
      'Adcos',
      'Principia',
      'Sallve',
      'The Body Shop',
      "Victoria's Secret",
      'Bath & Body Works',
      'Lancôme',
      'Dior',
      'Chanel',
      'Carolina Herrera',
      'Paco Rabanne',
      'Calvin Klein',
      'Hugo Boss',
      'Yves Saint Laurent',
      'Armani',
      'Versace',
      'Givenchy',
      'Zara',
    ],
    brandLabel: 'Marca',
    brandPlaceholder: 'Selecione ou digite a marca...',
    originOptions: ['Nacional', 'Importado', 'Revenda', 'Artesanal', 'Produção própria', 'Sem marca', 'Outros'],
    originPlaceholder: 'Ex: Nacional, Importado, Revenda...',
    productNamePlaceholder: 'Ex: Essencial Exclusivo Feminino',
    descriptionPlaceholder: 'Detalhes do produto, fragrância, volume, linha...',
    extraFields: [
      { key: 'volume_ml', label: 'Volume (ml)', placeholder: '50ml, 100ml...', type: 'text', halfWidth: true },
      { key: 'scent_family', label: 'Família Olfativa', placeholder: 'Floral, Amadeirado...', type: 'text', halfWidth: true },
      { key: 'skin_type', label: 'Tipo de Pele', placeholder: 'Seca, Oleosa, Mista...', type: 'text' },
    ],
    catalogFilters: ['Todos', 'Feminino', 'Masculino', 'Unissex', 'Kits', 'Promoções'],
  },

  'Roupas': {
    id: 'Roupas',
    label: 'Roupas',
    desc: 'Moda feminina, masculina, infantil...',
    iconName: 'Shirt',
    categories: [
      'Camisetas',
      'Calças',
      'Vestidos',
      'Shorts',
      'Saias',
      'Jaquetas',
      'Moda Infantil',
      'Moda Masculina',
      'Moda Feminina',
      'Plus Size',
      'Calçados',
      'Kits',
      'Outros',
    ],
    predefinedBrands: [
      'Sem marca',
      'Boutique',
      'Shein',
      'Renner',
      'C&A',
      'Riachuelo',
      'Marisa',
      'Zara',
      'Nike',
      'Adidas',
    ],
    brandLabel: 'Marca',
    brandPlaceholder: 'Ex: Boutique, Shein, Sem marca...',
    originOptions: ['Nacional', 'Importado', 'Revenda', 'Artesanal', 'Sem marca', 'Outros'],
    originPlaceholder: 'Ex: Nacional, Importado, Revenda...',
    productNamePlaceholder: 'Ex: Blusa canelada feminina',
    descriptionPlaceholder: 'Tamanho, tecido, cor, medidas, estado...',
    extraFields: [
      { key: 'size', label: 'Tamanho', placeholder: 'P, M, G, 42...', type: 'text', halfWidth: true },
      { key: 'color', label: 'Cor', placeholder: 'Azul, Preto...', type: 'text', halfWidth: true },
      { key: 'public_type', label: 'Gênero / Público', placeholder: 'Selecione...', type: 'select', options: ['Feminino', 'Masculino', 'Unissex', 'Infantil', 'Plus Size'] },
      { key: 'variation', label: 'Variação', placeholder: 'Modelo, estampa, coleção...', type: 'text' },
      { key: 'material', label: 'Material', placeholder: 'Algodão, Jeans, Poliéster...', type: 'text' },
    ],
    catalogFilters: ['Todos', 'Feminino', 'Masculino', 'Infantil', 'Plus Size', 'Promoções'],
  },

  'Acessórios': {
    id: 'Acessórios',
    label: 'Acessórios',
    desc: 'Joias, relógios, bolsas, óculos...',
    iconName: 'Watch',
    categories: [
      'Colares',
      'Brincos',
      'Pulseiras',
      'Relógios',
      'Óculos',
      'Bolsas',
      'Carteiras',
      'Bonés',
      'Bijuterias',
      'Kits',
      'Outros',
    ],
    predefinedBrands: [
      'Sem marca',
      'Prata 925',
      'Rommanel',
      'Pandora',
      'Vivara',
      'Chilli Beans',
      'Ray-Ban',
      'Kipling',
      'Outros',
    ],
    brandLabel: 'Marca / Coleção',
    brandPlaceholder: 'Ex: Vivara, Prata 925, Sem marca...',
    originOptions: ['Nacional', 'Importado', 'Artesanal', 'Revenda', 'Sem marca', 'Outros'],
    originPlaceholder: 'Ex: Importado, Artesanal, Revenda...',
    productNamePlaceholder: 'Ex: Bolsa transversal feminina',
    descriptionPlaceholder: 'Material, cor, tamanho, modelo, conservação...',
    extraFields: [
      { key: 'color', label: 'Cor', placeholder: 'Dourado, Prata, Preto...', type: 'text', halfWidth: true },
      { key: 'material', label: 'Material', placeholder: 'Couro, Metal, Silicone...', type: 'text', halfWidth: true },
      { key: 'model', label: 'Modelo', placeholder: 'Transversal, redondo, argola...', type: 'text' },
    ],
    catalogFilters: ['Todos', 'Bolsas', 'Óculos', 'Relógios', 'Joias/Bijus', 'Promoções'],
  },

  'Alimentos/Doces': {
    id: 'Alimentos/Doces',
    label: 'Alimentos/Doces',
    desc: 'Bolos, trufas, marmitas, bebidas...',
    iconName: 'Cookie',
    categories: [
      'Bolos',
      'Doces',
      'Trufas',
      'Tortas',
      'Salgados',
      'Marmitas',
      'Bebidas',
      'Chocolates',
      'Kits',
      'Encomendas',
      'Promoções',
      'Outros',
    ],
    predefinedBrands: [
      'Produção própria',
      'Caseiro',
      'Artesanal',
      'Sem marca',
      'Outros',
    ],
    brandLabel: 'Fornecedor / Marca',
    brandPlaceholder: 'Ex: Produção própria, Caseiro...',
    originOptions: ['Produção própria', 'Artesanal', 'Caseiro', 'Revenda', 'Outros'],
    originPlaceholder: 'Ex: Produção própria, Artesanal...',
    productNamePlaceholder: 'Ex: Bolo de pote chocolate',
    descriptionPlaceholder: 'Sabor, peso, validade, ingredientes, alergênicos...',
    extraFields: [
      { key: 'expiration_date', label: 'Validade', placeholder: '', type: 'date' },
      { key: 'weight', label: 'Peso / Volume', placeholder: '200g, 1kg, 500ml...', type: 'text', halfWidth: true },
      { key: 'flavor', label: 'Sabor', placeholder: 'Chocolate, Morango...', type: 'text', halfWidth: true },
      { key: 'availability', label: 'Entrega', placeholder: 'Selecione...', type: 'select', options: ['Pronta entrega', 'Sob encomenda'] },
    ],
    catalogFilters: ['Todos', 'Doces', 'Bolos', 'Bebidas', 'Marmitas', 'Combos', 'Promoções'],
  },

  'Geral': {
    id: 'Geral',
    label: 'Geral / Outros',
    desc: 'Variedades ou outros nichos...',
    iconName: 'Box',
    categories: [
      'Produto',
      'Casa',
      'Decoração',
      'Papelaria',
      'Eletrônicos',
      'Utilidades',
      'Presentes',
      'Brinquedos',
      'Variados',
      'Outros',
    ],
    predefinedBrands: [
      'Sem marca',
      'Marca própria',
      'Outros',
    ],
    brandLabel: 'Marca',
    brandPlaceholder: 'Ex: Sem marca, marca própria, outros...',
    originOptions: ['Nacional', 'Importado', 'Artesanal', 'Produção própria', 'Revenda', 'Sem marca', 'Outros'],
    originPlaceholder: 'Ex: Nacional, Importado, Artesanal...',
    productNamePlaceholder: 'Ex: Garrafa térmica inox',
    descriptionPlaceholder: 'Características, medidas, estado, observações...',
    extraFields: [
      { key: 'extra_notes', label: 'Observações Extras', placeholder: 'Detalhes relevantes...', type: 'text' },
    ],
    catalogFilters: ['Todos', 'Destaques', 'Promoções', 'Novidades', 'Kits'],
  },
};

/**
 * Retorna o config de nicho para um ID, com fallback para 'Geral'
 */
export function getNichoConfig(nichoId: string): NichoConfig {
  return NICHO_CONFIG[nichoId as NichoId] ?? NICHO_CONFIG['Geral'];
}

/**
 * Retorna as categorias de múltiplos nichos, sem duplicatas, mantendo ordem
 */
export function getMergedCategories(nichoIds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of nichoIds) {
    const config = getNichoConfig(id);
    for (const cat of config.categories) {
      if (!seen.has(cat)) {
        seen.add(cat);
        result.push(cat);
      }
    }
  }
  return result;
}

/**
 * Retorna o nicho mais provável com base na categoria do produto
 * Usado quando um produto existente não tem productType salvo
 */
export function inferNichoFromCategory(category: string): NichoId {
  for (const [nichoId, config] of Object.entries(NICHO_CONFIG)) {
    if (config.categories.includes(category)) {
      return nichoId as NichoId;
    }
  }
  return 'Geral';
}

/**
 * Retorna o nicho primário a partir de um array de tipos
 * Backward compat: se vazio, retorna 'Geral'
 */
export function getPrimaryNicho(businessTypes: string[]): NichoId {
  if (!businessTypes || businessTypes.length === 0) return 'Geral';
  return (NICHO_CONFIG[businessTypes[0] as NichoId] ? businessTypes[0] : 'Geral') as NichoId;
}

/**
 * Converte businessType (singular, legado) para businessTypes (array, novo)
 */
export function toBusinessTypesArray(
  businessType: string | undefined,
  businessTypes: string[] | undefined
): string[] {
  const validBusinessTypes = (businessTypes || []).filter((type): type is NichoId => type in NICHO_CONFIG);
  if (validBusinessTypes.length > 0) return validBusinessTypes;
  if (businessType && businessType in NICHO_CONFIG) return [businessType];
  return ['Geral'];
}

/**
 * Retorna o nome da loja para um nicho específico.
 * Se storeNamesByNicho[nicho] existe, usa. Senão, usa storeName padrão.
 * 
 * FUTURO-PROOF: permite diferentes nomes de loja por nicho sem reestruturação.
 * Hoje: um nome principal. Amanhã: nomes específicos por nicho.
 */
export function getStoreName(
  settings: { storeName?: string; storeNamesByNicho?: Record<string, string> } | undefined,
  nicho: string
): string {
  if (!settings) return '';
  // Se existe nome específico para este nicho, usa
  if (settings.storeNamesByNicho?.[nicho]) {
    return settings.storeNamesByNicho[nicho];
  }
  // Senão, usa o nome principal padrão
  return settings.storeName || '';
}


export type NichoCategoryPreferences = Record<string, string[]>;

type SettingsWithCategoryPreferences = {
  customCategoriesByNicho?: NichoCategoryPreferences;
  productCategoriesByNicho?: NichoCategoryPreferences;
};

function normalizeCategoryList(categories: unknown): string[] {
  if (!Array.isArray(categories)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of categories) {
    const category = String(raw ?? '').trim().replace(/\s+/g, ' ');
    const key = category.toLocaleLowerCase('pt-BR');
    if (category.length >= 2 && !seen.has(key)) {
      seen.add(key);
      result.push(category);
    }
  }
  return result;
}

/**
 * Retorna categorias efetivas para cadastro/listagem.
 * Se o usuário configurou categorias no onboarding, elas substituem a lista padrão daquele nicho.
 * Mantém fallback por nicho para usuários antigos e evita misturar categorias genéricas fora de "Geral".
 */
export function getProductCategoriesForNicho(
  settings: SettingsWithCategoryPreferences | undefined,
  nichoId: string,
): string[] {
  const config = getNichoConfig(nichoId);
  const configured = normalizeCategoryList(
    settings?.customCategoriesByNicho?.[config.id] || settings?.productCategoriesByNicho?.[config.id]
  );
  return configured.length > 0 ? configured : config.categories;
}
