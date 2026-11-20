'use client';
import SiteChrome from '../../components/SiteChrome';
import ImageCarousel from '../../components/ImageCarousel';
import {useEffect,useState} from 'react';
export default function AcademyAdmin(){const [ok,setOk]=useState(false);useEffect(()=>{setOk(true)},[]);return <SiteChrome><ImageCarousel compact/><main className="page section academy"><span className="eyebrow">HOSPITAL CHAPEL ACADEMY</span><h1>Academy Administration</h1><p className="lead">Secure workspace for authorized Academy personnel.</p>{ok&&<p><a className="primary" href="/admin">Open Academy administration sign-in →</a></p>}<div className="pending-panel">Academy records are isolated from church pastoral and finance records. Access is limited by Academy scope and role. Student and guardian records are not publicly listed.</div></main></SiteChrome>}
