# Coffee Grid

A beautiful, interactive coffee recipe website featuring an infinite scrollable grid of coffee bags. Click on any bag to view detailed brewing recipes and tasting notes.

## ✨ Features

### V2 – Search & Filter

- **Search**: Search by name, tags, tasting notes, or coffee number. Results update as you type. Use `/` to focus the search bar.
- **Filter Modal**: Filter coffee bags by:
  - **Type** (Espresso, Pourover, Aeropress, etc.)
  - **Brewer** (Gaggia Classic Pro, Niche Zero, Hario V60, etc.)
  - **Grinder** (Niche Zero, Hario Slim Hand Grinder, etc.)
  - **Rating** (3–5 stars)
  - **Tasting Notes** (Chocolate, Citrus, Fruity, etc.)
- **Combined Search & Filter**: Apply filters first, then search within results—or search first, then refine with filters.
- **Active Filter Indicator**: A dot on the filter button shows when filters are applied.
- **No Match State**: When no results match, a "Show all" button resets search and filters.

### V3 – Editable Metadata (Supabase)

- **Inline Editing**: When using Supabase, sign in to edit coffee metadata directly in the app.
- **Editable Fields**: Name, rating, tags, roaster, origin, process, tasting notes, brewer, grinder, recipe markdown, and bag image.
- **Image Upload**: Replace coffee bag images via the edit form; images are stored in Supabase Storage.
- **Single Admin**: One authenticated user can edit; sign-up can be disabled for a personal recipe app.
- **Fallback**: Without Supabase configuration, the app works with static JSON and recipe files as before.

See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for setup instructions.

### Core Features

- **Infinite Grid Layout**: Seamlessly scrollable masonry grid with drag-to-explore navigation
- **Interactive Coffee Bags**: Click any bag to open a detailed modal with:
  - Coffee information (roaster, origin, process)
  - Tasting notes displayed as pills
  - Full brewing recipes in markdown format
  - High-quality bag imagery
- **Smooth Performance**: Optimized rendering with GPU acceleration and efficient clone management
- **Responsive Design**: Works beautifully on desktop and mobile devices
- **Markdown Recipes**: Easy-to-edit recipe files in markdown format

## 🚀 Getting Started

### Prerequisites

- Node.js (v16 or higher recommended)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/coffee-grid.git
cd coffee-grid
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

### Optional: Enable Editable Metadata (Supabase)

1. Create a Supabase project and follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md).
2. Copy `.env.example` to `.env` and add your `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Run `npm run migrate` to seed data (requires `SUPABASE_SERVICE_ROLE_KEY` in `.env`).
4. Sign in via the "Sign in" button to edit coffee metadata.

## 📦 Building for Production

To create a production build:

```bash
npm run build
```

The built files will be in the `dist` directory. You can preview the production build locally with:

```bash
npm run preview
```

## 🗂️ Project Structure

```
coffee-grid/
├── public/
│   ├── bags/          # Coffee bag images (coffee-bag-01.png, etc.)
│   ├── data/          # coffee.json - metadata (name, tags, rating, etc.)
│   └── recipes/       # Markdown recipe files (coffee-01.md, etc.)
├── supabase/
│   └── migrations/    # SQL schema for Supabase
├── scripts/
│   └── migrate-to-supabase.js   # One-time migration script
├── src/
│   ├── data/
│   │   └── coffee.json    # Coffee metadata (names, tags, etc.)
│   ├── main.js        # Main application logic
│   └── style.css      # Styles
├── index.html
├── package.json
└── README.md
```

## 📝 Adding Coffee Recipes

1. Add a coffee bag image to `public/bags/` (e.g., `coffee-bag-21.png`)
2. Create a markdown recipe file in `public/recipes/` (e.g., `coffee-21.md`)
3. Add the coffee entry to `src/data/coffee.json`:

```json
{
  "id": "unique-id",
  "number": 21,
  "name": "Coffee Name",
  "rating": 5,
  "tags": ["Espresso", "Pourover"],
  "roaster": "Roaster Name",
  "origin": "Origin Country",
  "process": "Processing Method",
  "notes": ["Note 1", "Note 2"],
  "brew": "Brewing instructions"
}
```

## 🎨 Customization

- **Styling**: Edit `src/style.css` to customize colors, fonts, and layout
- **Grid Layout**: Modify tile dimensions, columns, and spacing in `src/main.js`
- **Modal Content**: Customize the modal layout and content structure in `src/main.js`

## 🛠️ Technologies Used

- **Vite** - Build tool and dev server
- **Supabase** - Database, auth, and storage (optional)
- **Vanilla JavaScript** - No frameworks, pure JS
- **CSS3** - Modern CSS with GPU-accelerated transforms
- **Markdown** - Recipe content format

## 📱 Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## 🚢 Deployment

This project can be easily deployed to:

- **Vercel**: Connect your GitHub repo for automatic deployments. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in project settings if using Supabase.
- **Netlify**: Drag & drop the `dist` folder or connect via Git
- **GitHub Pages**: Enable Pages in repo settings, set source to `dist` folder
- **Cloudflare Pages**: Connect repository and set build command to `npm run build`

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🗺️ Roadmap

Future versions may include:

- Favorites/bookmarking system
- Recipe sharing
- More customization options
- Performance optimizations

---

Made with ☕ and ❤️
