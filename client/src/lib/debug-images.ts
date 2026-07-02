/**
 * Debug utility for image loading across screens
 * Logs the exact object passed to ProductImageCard in each view
 */

export const logProductImageData = (
  screenName: string,
  product: any,
  context?: any
) => {
  const log = {
    timestamp: new Date().toISOString(),
    screen: screenName,
    productName: product?.name || "unknown",
    productId: product?.id || "unknown",
    hasImageUrl: !!product?.imageUrl,
    imageUrl: product?.imageUrl ? product.imageUrl.substring(0, 100) : "MISSING",
    hasImageId: !!product?.imageId,
    imageId: product?.imageId,
    productKeys: Object.keys(product || {}),
    fullProduct: product,
    ...(context && { context })
  };

  console.group(`🖼️ [${screenName}] Product Image Data`);
  console.groupEnd();

  return log;
};

/**
 * Wrapper to check if imageUrl will load
 */
export const willImageLoad = (product: any): boolean => {
  if (!product) return false;
  const imageUrl = product?.imageUrl;
  return imageUrl && String(imageUrl).trim().length > 0;
};
