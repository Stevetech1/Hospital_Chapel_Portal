import { ReactNode } from 'react';
import SiteChrome from './SiteChrome';
import ImageCarousel from './ImageCarousel';
export default function PublicPage({ children, title, subtitle, eyebrow = 'HOSPITAL CHAPEL UATH' }: { children: ReactNode; title: string; subtitle?: string; eyebrow?: string }) {
  return <SiteChrome><main className="public-page"><ImageCarousel compact/><section className="section public-content"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{subtitle && <p className="lead">{subtitle}</p>}{children}</section></main></SiteChrome>;
}
