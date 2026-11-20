import './styles.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';
import type { Metadata } from 'next';
export const metadata: Metadata = {
 title: 'Hospital Chapel UATH | Faith, Service & Community',
 description: 'Hospital Chapel, University of Abuja Teaching Hospital, Gwagwalada, Abuja.',
 manifest: '/manifest.webmanifest',
 icons: { icon: '/media/hospital-chapel-logo.jpeg', apple: '/media/hospital-chapel-logo.jpeg' },
 openGraph: { title: 'Hospital Chapel UATH', description: 'Faith, service and community at Hospital Chapel, UATH Gwagwalada.' }
};
export default function RootLayout({children}:{children:React.ReactNode}) {
 return <html lang="en"><body><ServiceWorkerRegister />{children}</body></html>;
}
