export default function Home() {
  return (
    <main>
      <h1>StellarVeriphy</h1>
      <p>Decentralized content verification and provenance on the Stellar blockchain.</p>
import Link from "next/link";
import { FEATURED_SAMPLE_ID } from "@/lib/sample-records";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">StellarVeriphy</h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">
        Decentralized content verification and provenance on the Stellar blockchain.
      </p>

      <section aria-labelledby="cta-heading" className="mt-10 max-w-2xl rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="cta-heading" className="text-xl font-semibold">
          See verification in action
        </h2>
        <p className="mt-2 text-slate-600">
          Browse photos, videos and documents that have been checked and certified on-chain. Open any item to see
          who created it, how it was verified, and every step in its history.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/explore"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Explore verified content
            <span aria-hidden="true" className="ml-2">
              →
            </span>
          </Link>
          <Link
            href={`/certificates/${FEATURED_SAMPLE_ID}`}
            className="inline-flex items-center justify-center rounded-lg px-5 py-3 text-base font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            View a sample certificate
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate-500">No account or wallet needed to browse.</p>
      </section>
import { Footer } from "@/components/Footer";
import { AboutSection } from "@/components/landing/AboutSection";
import { CallToActionSection } from "@/components/landing/CallToActionSection";
import { EcosystemSection } from "@/components/landing/EcosystemSection";
import { Header } from "@/components/landing/Header";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";

export default function Home() {
  return (
    <main
      id="main-content"
      className="min-h-screen bg-slate-900 scroll-smooth"
      aria-label="Main content"
    >
      <Header />
      <div className="pt-16">
        <HeroSection />
        <AboutSection />
        <HowItWorksSection />
        <EcosystemSection />
        <CallToActionSection />
        <Footer />
      </div>
    </main>
  );
}
