import factorioPoster from '../../../assets/factorio-simple.png'
import onboardingPoster from '../../../assets/onboarding.avif'

export interface PromoBannerItem {
  watermark: string
  title: string
  eventName: string
  date: string
  reward: string
  cta: string
}

export type PromoBannerItemKey = 'signin' | 'build' | 'spring' | 'coupon' | 'home'

export type PromoBannerAction
  = | { type: 'login' }
    | { type: 'route', to: string }

export interface PromoBannerVisual {
  key: PromoBannerItemKey
  image: string
  action: PromoBannerAction
  accentClass: string
  fallbackIcon: string
  fallbackIconClass: string
  fallbackClass: string
}

export function getPromoBannerFallbackLabelKey(key: PromoBannerItemKey) {
  return `stage.promo-banner.items.${key}.fallbackLabel`
}

export const promoBannerVisuals: PromoBannerVisual[] = [
  {
    key: 'signin',
    image: onboardingPoster,
    action: { type: 'login' },
    accentClass: 'from-fuchsia-500/30 via-rose-400/18 to-transparent',
    fallbackIcon: 'i-solar:stars-line-duotone',
    fallbackIconClass: 'text-amber-100',
    fallbackClass: 'from-fuchsia-300/25 via-rose-300/14 to-violet-400/20',
  },
  {
    key: 'build',
    image: factorioPoster,
    action: { type: 'route', to: '/settings/modules/consciousness' },
    accentClass: 'from-cyan-500/30 via-sky-400/18 to-transparent',
    fallbackIcon: 'i-solar:box-bold-duotone',
    fallbackIconClass: 'text-cyan-100',
    fallbackClass: 'from-cyan-300/25 via-sky-300/14 to-blue-400/20',
  },
  {
    key: 'home',
    image: '',
    action: { type: 'route', to: '/settings/scene' },
    accentClass: 'from-sky-400/28 via-indigo-300/14 to-transparent',
    fallbackIcon: 'i-solar:home-angle-bold-duotone',
    fallbackIconClass: 'text-sky-100',
    fallbackClass: 'from-sky-300/25 via-indigo-300/14 to-violet-400/18',
  },
]
