'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Logo } from '@/components/Logo';
import AlertDemo from '@/components/AlertDemo';
import { Button } from '@/components/ui/Button';
import { Shield, BellRing, Target, Activity, Menu, X, Globe } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function LandingPage() {
  const { language, setLanguage, t } = useLanguage();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const features = [
    {
      icon: <Target className="w-6 h-6 text-sky-500" />,
      title: t.landing.features.f1_title,
      desc: t.landing.features.f1_desc
    },
    {
      icon: <BellRing className="w-6 h-6 text-teal-500" />,
      title: t.landing.features.f2_title,
      desc: t.landing.features.f2_desc
    },
    {
      icon: <Shield className="w-6 h-6 text-sky-500" />,
      title: t.landing.features.f3_title,
      desc: t.landing.features.f3_desc
    },
    {
      icon: <Activity className="w-6 h-6 text-teal-500" />,
      title: t.landing.features.f4_title,
      desc: t.landing.features.f4_desc
    }
  ];

  const steps = [
    { title: t.landing.howItWorks.s1_title, desc: t.landing.howItWorks.s1_desc },
    { title: t.landing.howItWorks.s2_title, desc: t.landing.howItWorks.s2_desc },
    { title: t.landing.howItWorks.s3_title, desc: t.landing.howItWorks.s3_desc },
    { title: t.landing.howItWorks.s4_title, desc: t.landing.howItWorks.s4_desc }
  ];

  return (
    <div className="min-h-screen bg-navy-50 font-sans selection:bg-sky-500/30">
      {/* Navigation */}
      <nav className={`fixed w-full z-50 transition-all duration-300 ${isScrolled ? 'bg-white/90 backdrop-blur-md shadow-sm py-3' : 'bg-transparent py-5'}`}>
        <div className="container mx-auto px-4 md:px-6 flex items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-navy-800 hover:text-sky-600 transition-colors">{t.landing.nav.features}</a>
            <a href="#how-it-works" className="text-sm font-medium text-navy-800 hover:text-sky-600 transition-colors">{t.landing.nav.howItWorks}</a>
            
            <div className="flex items-center gap-4 border-l border-gray-200 pl-6">
              <button 
                onClick={() => setLanguage(language === 'en' ? 'vi' : 'en')}
                className="flex items-center gap-2 text-sm font-medium text-navy-800 hover:text-sky-600"
              >
                <Globe className="w-4 h-4" />
                {language.toUpperCase()}
              </button>
              <Link href="/login">
                <Button variant="outline" size="sm">{t.landing.nav.login}</Button>
              </Link>
              <Link href="/register">
                <Button size="sm">{t.landing.nav.signup}</Button>
              </Link>
            </div>
          </div>

          {/* Mobile Menu Toggle */}
          <button className="md:hidden text-navy-900" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {/* Mobile Nav */}
        {mobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="absolute top-full left-0 w-full bg-white shadow-lg border-t border-gray-100 p-4 flex flex-col gap-4 md:hidden"
          >
            <a href="#features" className="text-sm font-medium p-2" onClick={() => setMobileMenuOpen(false)}>{t.landing.nav.features}</a>
            <a href="#how-it-works" className="text-sm font-medium p-2" onClick={() => setMobileMenuOpen(false)}>{t.landing.nav.howItWorks}</a>
            <hr />
            <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="outline" className="w-full">{t.landing.nav.login}</Button>
            </Link>
            <Link href="/register" onClick={() => setMobileMenuOpen(false)}>
              <Button className="w-full">{t.landing.nav.signup}</Button>
            </Link>
          </motion.div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-100 via-white to-white -z-10" />
        
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5 }}
              className="max-w-2xl"
            >
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-navy-900 leading-tight mb-6">
                {t.landing.hero.title} <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-500 to-teal-400">{t.landing.hero.titleHighlight}</span>
              </h1>
              <p className="text-lg text-gray-600 mb-8 leading-relaxed">
                {t.landing.hero.subtitle}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Link href="/register">
                  <Button size="lg" className="text-base h-12 px-8">{t.landing.hero.getStarted}</Button>
                </Link>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="flex justify-center lg:justify-end"
              id="demo"
            >
              <AlertDemo />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 bg-white">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold text-navy-900 mb-4">{t.landing.features.title}</h2>
            <p className="text-gray-600">{t.landing.features.subtitle}</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((f, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-navy-50 p-6 rounded-2xl border border-sky-100/50 hover:shadow-lg hover:border-sky-200 transition-all"
              >
                <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center mb-6">
                  {f.icon}
                </div>
                <h3 className="text-xl font-semibold text-navy-900 mb-3">{f.title}</h3>
                <p className="text-gray-600 leading-relaxed text-sm">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works Section */}
      <section id="how-it-works" className="py-20 bg-navy-900 text-white">
        <div className="container mx-auto px-4 md:px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold mb-4">{t.landing.howItWorks.title}</h2>
            <p className="text-gray-400">{t.landing.howItWorks.subtitle}</p>
          </div>

          <div className="grid md:grid-cols-4 gap-8 relative">
            {/* Connecting line for desktop */}
            <div className="hidden md:block absolute top-8 left-[12%] right-[12%] h-0.5 bg-gradient-to-r from-sky-500/0 via-sky-500/50 to-sky-500/0" />
            
            {steps.map((step, i) => (
              <div key={i} className="relative z-10 flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-full bg-navy-800 border-2 border-sky-500 flex items-center justify-center text-xl font-bold text-sky-400 mb-6 shadow-[0_0_15px_rgba(14,165,233,0.3)]">
                  {i + 1}
                </div>
                <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                <p className="text-gray-400 text-sm">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <footer className="py-12 bg-white border-t border-gray-100">
        <div className="container mx-auto px-4 md:px-6 flex flex-col items-center text-center">
          <h2 className="text-2xl font-bold text-navy-900 mb-6">{t.landing.footer.cta}</h2>
          <Link href="/register">
            <Button size="lg" className="px-8">{t.landing.footer.createAccount}</Button>
          </Link>
          <div className="mt-12 text-sm text-gray-500">
            &copy; {new Date().getFullYear()} {t.landing.footer.copyright}
          </div>
        </div>
      </footer>
    </div>
  );
}
