// Configuración pública para el navegador. La publishable key (antes "anon") es pública por diseño:
// la seguridad la dan las políticas RLS de la base de datos.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'config', message: 'Faltan SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en las variables de entorno de Vercel.' });
  }
  return res.status(200).json({ supabaseUrl: url, supabaseAnonKey: key });
};
