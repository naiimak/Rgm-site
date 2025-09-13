# RGM LLC Website

A modern, responsive website for RGM LLC - Real Estate Investment Solutions. Built with Next.js 14, TypeScript, and Tailwind CSS.

## 🚀 Features

- **Modern Tech Stack**: Next.js 14 with App Router, TypeScript, and Tailwind CSS
- **Responsive Design**: Mobile-first approach with breakpoints at 375px, 768px, 1024px, 1280px
- **SEO Optimized**: Built-in metadata, sitemap generation, and structured data
- **Performance**: Optimized images with next/image, lazy loading, and minimal CLS
- **Accessibility**: Semantic HTML, ARIA labels, and proper contrast ratios
- **Contact Form**: Functional contact form with validation and API endpoint
- **Production Ready**: Configured for Vercel deployment with security headers

## 📁 Project Structure

```
├── app/
│   ├── (marketing)/          # Marketing pages
│   │   ├── about/
│   │   ├── contact/
│   │   └── services/
│   ├── api/
│   │   └── contact/          # Contact form API endpoint
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/               # Reusable UI components
│   ├── ContactForm.tsx
│   ├── Footer.tsx
│   └── Header.tsx
├── lib/                     # Utility functions
│   └── utils.ts
├── public/                  # Static assets
│   ├── icons/
│   ├── images/
│   ├── manifest.json
│   ├── robots.txt
│   └── sitemap.xml
├── next-sitemap.config.js   # Sitemap configuration
├── next.config.js           # Next.js configuration
├── tailwind.config.ts       # Tailwind CSS configuration
├── vercel.json             # Vercel deployment configuration
└── package.json
```

## 🛠️ Development

### Prerequisites

- Node.js 18.17 or later
- npm, yarn, or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/naiimak/Rgm-site.git
   cd Rgm-site
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   # or
   pnpm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting
- `npm run type-check` - Run TypeScript type checking

## 🏗️ Build and Deploy

### Build Locally

```bash
npm run build
npm run start
```

### Deploy to Vercel

1. **Connect to Vercel:**
   ```bash
   npx vercel
   ```

2. **Configure Environment Variables** (if needed):
   - Go to your Vercel dashboard
   - Navigate to your project settings
   - Add environment variables for email services (if implementing)

3. **Deploy:**
   ```bash
   npx vercel --prod
   ```

## 🌐 Domain Configuration (rgmsllc.com)

### Shopify DNS Setup

Since the domain `rgmsllc.com` is managed through Shopify, follow these steps:

1. **Access Shopify Admin:**
   - Go to your Shopify admin panel
   - Navigate to Settings > Domains

2. **Configure DNS Records:**
   
   **For the apex domain (rgmsllc.com):**
   ```
   Type: A
   Name: @
   Value: 76.76.21.21
   TTL: 300 (or auto)
   ```

   **For www subdomain (www.rgmsllc.com):**
   ```
   Type: CNAME
   Name: www
   Value: cname.vercel-dns.com
   TTL: 300 (or auto)
   ```

3. **Preserve Existing Records:**
   - Keep existing MX records for email functionality
   - Keep any other DNS records that are currently working

4. **Verify in Vercel:**
   - Go to your Vercel project dashboard
   - Navigate to Settings > Domains
   - Add `rgmsllc.com` and `www.rgmsllc.com`
   - Vercel will automatically verify the DNS configuration

5. **SSL Certificate:**
   - Vercel will automatically provision SSL certificates
   - No additional configuration needed

### Domain Redirect Configuration

The site is configured to redirect www to apex domain:
- `www.rgmsllc.com` → `rgmsllc.com`

This is handled in `vercel.json` configuration.

## 📧 Contact Form Configuration

The contact form currently logs submissions to the console. To enable email functionality:

### Option 1: Resend (Recommended)

1. Install Resend:
   ```bash
   npm install resend
   ```

2. Add environment variables to Vercel:
   ```
   RESEND_API_KEY=your_resend_api_key
   ```

3. Update `app/api/contact/route.ts` to use Resend (code commented in file)

### Option 2: SendGrid

1. Install SendGrid:
   ```bash
   npm install @sendgrid/mail
   ```

2. Add environment variables:
   ```
   SENDGRID_API_KEY=your_sendgrid_api_key
   ```

### Option 3: Formspree

1. Create account at [Formspree](https://formspree.io)
2. Update form action to use Formspree endpoint
3. No backend changes needed

## 🎨 Content and Asset Updates

### Updating Content

1. **Page Content**: Edit files in `app/(marketing)/` directories
2. **Header/Footer**: Modify `components/Header.tsx` and `components/Footer.tsx`
3. **SEO Metadata**: Update `app/layout.tsx` and individual page metadata

### Adding Images

1. Add images to `public/images/` directory
2. Use Next.js Image component for optimization:
   ```tsx
   import Image from 'next/image'
   
   <Image
     src="/images/your-image.jpg"
     alt="Description"
     width={800}
     height={600}
     priority // for above-the-fold images
   />
   ```

### Updating Styling

1. **Global Styles**: Edit `app/globals.css`
2. **Component Styles**: Use Tailwind classes
3. **Custom Colors**: Update `tailwind.config.ts`

## 📱 Responsive Breakpoints

The site is optimized for these breakpoints:
- Mobile: 375px+
- Tablet: 768px+
- Desktop: 1024px+
- Large Desktop: 1280px+

## 🔧 Performance Optimization

- **Images**: Automatic optimization with next/image
- **Fonts**: System fonts for fast loading
- **Code Splitting**: Automatic with Next.js App Router
- **Lazy Loading**: Images and components
- **Caching**: Optimized cache headers

## 📊 Analytics (Optional)

To add analytics, uncomment and configure in `app/layout.tsx`:

### Google Analytics 4
```tsx
import { GoogleAnalytics } from '@next/third-parties/google'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <GoogleAnalytics gaId="GA_MEASUREMENT_ID" />
      </body>
    </html>
  )
}
```

### Meta Pixel
```tsx
import { FacebookPixel } from '@next/third-parties/google'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <FacebookPixel pixelId="PIXEL_ID" />
      </body>
    </html>
  )
}
```

## 🚨 Troubleshooting

### Build Errors
- Ensure all dependencies are installed: `npm install`
- Check TypeScript errors: `npm run type-check`
- Verify environment variables are set correctly

### DNS Issues
- Allow 24-48 hours for DNS propagation
- Use DNS checker tools to verify records
- Ensure Shopify DNS settings are correct

### Performance Issues
- Run `npm run build` to check bundle size
- Use Next.js built-in bundle analyzer
- Optimize images and reduce unused CSS

## 📞 Support

For technical support or questions about this implementation:
- Check Next.js documentation: [nextjs.org/docs](https://nextjs.org/docs)
- Vercel deployment guide: [vercel.com/docs](https://vercel.com/docs)
- Tailwind CSS documentation: [tailwindcss.com/docs](https://tailwindcss.com/docs)

## 📄 License

This project is private and proprietary to RGM LLC.
