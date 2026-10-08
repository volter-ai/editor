/** Project creation is executable product code, shared by its CLI and the host. */
export interface ProductCreateRequest {
  name: string;
  targetDir: string;
  template?: string;
}
export interface ProductCreateResult {
  targetDir: string;
  manifest: unknown;
}
export interface ProductCreateDeclaration {
  readonly product: string;
  readonly templates: readonly { readonly id: string; readonly name: string; readonly description?: string }[];
  create(request: ProductCreateRequest): Promise<ProductCreateResult>;
}
export function assertProductCreateDeclaration(value: unknown, source: string): ProductCreateDeclaration {
  const declaration = value as Partial<ProductCreateDeclaration> | null;
  if (!declaration || typeof declaration.product !== 'string' ||
      typeof declaration.create !== 'function' || !Array.isArray(declaration.templates) ||
      declaration.templates.some(t => typeof t?.id !== 'string' || typeof t?.name !== 'string')) {
    throw new Error(`${source}: expected a product, templates and create(request) function`);
  }
  return declaration as ProductCreateDeclaration;
}
