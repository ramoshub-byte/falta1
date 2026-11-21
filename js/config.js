/* Configuração da ligação ao Supabase.
 *
 * Deixa os dois campos vazios para usar o MODO DEMONSTRAÇÃO (tudo fica neste browser, com jogadores fictícios).
 * Para o piloto real, cola aqui os valores de Supabase → Project Settings → API:
 *   - Project URL         → supabaseUrl
 *   - anon / public key   → supabaseAnonKey
 * A chave "anon" é pública por natureza: quem protege os dados são as regras de segurança em supabase/schema.sql.
 * NUNCA coloques aqui a chave "service_role".
 */
window.PADEL_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};
