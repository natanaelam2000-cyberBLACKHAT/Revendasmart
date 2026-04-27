/**
 * NICHO-CONFIG — Fonte única de configuração por tipo de negócio
 *
 * Usado por: add-product, onboarding, settings, catalog
 *
 * Regras:
 * - Categorias são isoladas por nicho (sem mistura)
 * - Marcas pré-definidas existem só para Cosméticos & Perfumes
 * - Demais nichos usam marca livre (campo texto)
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
  extraFields: ExtraFieldConfig[];
  /** Filtros disponíveis no catálogo para este nicho */
  catalogFilters: string[];
}

export const NICHO_CONFIG: Record<NichoId, NichoConfig> = {
  'Cosméticos & Perfumes': {
    id: 'Cosméticos & Perfumes',
    label: 'Cosméticos & Perfumes',
    desc: 'Natura, Boticário, Mary Kay...',
    iconName: 'Store',
    categories: [
      'Perfume',
      'Hidratante',
      'Sabonete',
      'Body Splash',
      'Creme',
      'Maquiagem',
      'Protetor Solar',
      'Kit',
      'Outros',
    ],
    predefinedBrands: [
      'Natura',
      'O Boticário',
      'Avon',
      'Eudora',
      'Mary Kay',
      'Quem Disse Berenice',
      'L\'Oréal',
      'Nivea',
    ],
    brandLabel: 'Marca',
    brandPlaceholder: 'Selecione ou digite a marca...',
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
      'Camiseta',
      'Vestido',
      'Calça',
      'Short',
      'Saia',
      'Conjunto',
      'Infantil',
      'Fitness',
      'Jaqueta',
      'Outros',
    ],
    predefinedBrands: undefined,
    brandLabel: 'Marca',
    brandPlaceholder: 'Ex: Renner, Zara, Marca própria...',
    extraFields: [
      { key: 'public_type', label: 'Público / Gênero', placeholder: 'Selecione...', type: 'select', options: ['Feminino', 'Masculino', 'Unissex', 'Infantil', 'Plus Size'] },
      { key: 'size', label: 'Tamanho', placeholder: 'P, M, G, 42...', type: 'text', halfWidth: true },
      { key: 'color', label: 'Cor', placeholder: 'Azul, Preto...', type: 'text', halfWidth: true },
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
      'Bolsa',
      'Relógio',
      'Óculos',
      'Joia/Bijuteria',
      'Cinto',
      'Carteira',
      'Boné',
      'Kit',
      'Outros',
    ],
    predefinedBrands: undefined,
    brandLabel: 'Marca / Coleção',
    brandPlaceholder: 'Ex: Vivara, marca própria...',
    extraFields: [
      { key: 'color', label: 'Cor', placeholder: 'Dourado, Prata, Preto...', type: 'text', halfWidth: true },
      { key: 'material', label: 'Material', placeholder: 'Couro, Metal, Silicone...', type: 'text', halfWidth: true },
    ],
    catalogFilters: ['Todos', 'Bolsas', 'Óculos', 'Relógios', 'Joias/Bijus', 'Promoções'],
  },

  'Alimentos/Doces': {
    id: 'Alimentos/Doces',
    label: 'Alimentos/Doces',
    desc: 'Bolos, trufas, marmitas, bebidas...',
    iconName: 'Cookie',
    categories: [
      'Bolo',
      'Trufa',
      'Brigadeiro',
      'Marmita',
      'Bebida',
      'Combo',
      'Salgado',
      'Kit Festa',
      'Outros',
    ],
    predefinedBrands: undefined,
    brandLabel: 'Fornecedor / Marca',
    brandPlaceholder: 'Ex: Cozinha da Maria, artesanal...',
    extraFields: [
      { key: 'weight', label: 'Peso / Quantidade', placeholder: '200g, 1kg, 12 unid...', type: 'text', halfWidth: true },
      { key: 'flavor', label: 'Sabor', placeholder: 'Chocolate, Morango...', type: 'text', halfWidth: true },
      { key: 'expiration_date', label: 'Validade', placeholder: '', type: 'date' },
    ],
    catalogFilters: ['Todos', 'Doces', 'Bolos', 'Bebidas', 'Marmitas', 'Combos', 'Promoções'],
  },

  'Geral': {
    id: 'Geral',
    label: 'Geral / Outros',
    desc: 'Variedades ou outros nichos...',
    iconName: 'Box',
    categories: [
      'Produto Geral',
      'Kit',
      'Variados',
      'Item Personalizado',
      'Outros',
    ],
    predefinedBrands: undefined,
    brandLabel: 'Marca / Origem',
    brandPlaceholder: 'Ex: marca própria, fornecedor...',
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
 * Backward compat: se vazio, retorna 'Cosméticos & Perfumes'
 */
export function getPrimaryNicho(businessTypes: string[]): NichoId {
  if (!businessTypes || businessTypes.length === 0) return 'Cosméticos & Perfumes';
  return (NICHO_CONFIG[businessTypes[0] as NichoId] ? businessTypes[0] : 'Geral') as NichoId;
}

/**
 * Converte businessType (singular, legado) para businessTypes (array, novo)
 */
export function toBusinessTypesArray(
  businessType: string | undefined,
  businessTypes: string[] | undefined
): string[] {
  if (businessTypes && businessTypes.length > 0) return businessTypes;
  if (businessType) return [businessType];
  return ['Cosméticos & Perfumes'];
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
