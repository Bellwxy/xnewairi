import { resolveBrand } from './config'

export const brand = resolveBrand(import.meta.env.AIRI_BRAND_JSON)
