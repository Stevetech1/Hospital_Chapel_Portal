'use client';
import { useEffect, useState } from 'react';

type Slide = { src: string; alt: string; caption: string; detail?: string };
const defaultSlides: Slide[] = [
  { src: 'https://images.unsplash.com/photo-1438232992991-995b7058bbb3?auto=format&fit=crop&w=1800&q=85', alt: 'Sunlight entering a church sanctuary', caption: 'A place to worship', detail: 'Growing together in faith, prayer and the Word.' },
  { src: 'https://images.unsplash.com/photo-1507692049790-de58290a4334?auto=format&fit=crop&w=1800&q=85', alt: 'Congregation gathered for worship', caption: 'A family in Christ', detail: 'Building and nurturing believers to share the Gospel.' },
  { src: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?auto=format&fit=crop&w=1800&q=85', alt: 'People serving and supporting one another', caption: 'Faith expressed through service', detail: 'Serving our hospital community with compassion.' },
  { src: 'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?auto=format&fit=crop&w=1800&q=85', alt: 'A community gathered together', caption: 'Growing in fellowship', detail: 'One community, united in worship and service.' }
];
export default function ImageCarousel({ slides = defaultSlides, compact = false }: { slides?: Slide[]; compact?: boolean }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % slides.length), 6000);
    return () => window.clearInterval(timer);
  }, [slides.length]);
  const current = slides[index];
  const move = (step: number) => setIndex(i => (i + step + slides.length) % slides.length);
  return <section className={`image-carousel ${compact ? 'compact' : ''}`} aria-label="Hospital Chapel image slideshow">
    <img key={current.src} src={current.src} alt={current.alt} />
    <div className="carousel-shade" />
    <div className="carousel-copy"><span>HOSPITAL CHAPEL UATH</span><h2>{current.caption}</h2><p>{current.detail}</p></div>
    <div className="carousel-controls"><button type="button" aria-label="Previous slide" onClick={() => move(-1)}>‹</button><div className="carousel-dots">{slides.map((slide, i) => <button type="button" key={slide.src} aria-label={`Show slide ${i + 1}`} aria-current={i === index} className={i === index ? 'active' : ''} onClick={() => setIndex(i)} />)}</div><button type="button" aria-label="Next slide" onClick={() => move(1)}>›</button></div>
  </section>;
}
