import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About Us - RGM LLC',
  description: 'Learn about RGM LLC, our mission, and our team of real estate investment professionals.',
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white">
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h1 className="text-5xl font-bold text-slate-900 mb-6">About RGM LLC</h1>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Dedicated to providing exceptional real estate investment solutions with integrity, expertise, and personalized service.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
            <div>
              <h2 className="text-3xl font-bold text-slate-900 mb-6">Our Mission</h2>
              <p className="text-lg text-slate-600 mb-6">
                At RGM LLC, we believe that real estate investment should be accessible, profitable, and stress-free. 
                Our mission is to provide our clients with expert guidance, innovative solutions, and unparalleled 
                service in the real estate investment market.
              </p>
              <p className="text-lg text-slate-600">
                We combine deep market knowledge with cutting-edge technology to identify the best investment 
                opportunities and deliver exceptional returns for our clients.
              </p>
            </div>
            <div className="bg-slate-100 h-64 rounded-lg flex items-center justify-center">
              <span className="text-slate-500">Mission Image Placeholder</span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="bg-slate-100 h-64 rounded-lg flex items-center justify-center order-2 md:order-1">
              <span className="text-slate-500">Values Image Placeholder</span>
            </div>
            <div className="order-1 md:order-2">
              <h2 className="text-3xl font-bold text-slate-900 mb-6">Our Values</h2>
              <ul className="space-y-4">
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center mr-4 mt-1">
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">Integrity</h3>
                    <p className="text-slate-600">We operate with transparency and honesty in every transaction.</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center mr-4 mt-1">
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">Excellence</h3>
                    <p className="text-slate-600">We strive for excellence in every aspect of our service delivery.</p>
                  </div>
                </li>
                <li className="flex items-start">
                  <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center mr-4 mt-1">
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">Innovation</h3>
                    <p className="text-slate-600">We embrace new technologies and strategies to stay ahead of the market.</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}