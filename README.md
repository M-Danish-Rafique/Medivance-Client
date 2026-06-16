# Medivance Client (Frontend)

React 18 frontend for the Medivance ERP system. Deploy on [Vercel](https://vercel.com).

## Setup

```bash
npm install
npm start
```

Local dev proxies `/api` to `http://localhost:5000`.

## Vercel

Set environment variable:

```
REACT_APP_API_URL=https://YOUR-RAILWAY-API.up.railway.app/api
```

`vercel.json` is included for SPA routing.
