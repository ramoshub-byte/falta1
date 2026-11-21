# Ligar a app ao Supabase (piloto real)

Sem este passo, a app funciona em **modo demonstração**, com jogadores fictícios guardados só no teu browser.
Leva cerca de 10 minutos.

## 1. Criar o projeto

1. Vai a [supabase.com](https://supabase.com) e entra com a tua conta do GitHub (é grátis).
2. **New project**
   - Name: `falta1`
   - Database password: gera uma e guarda-a num sítio seguro
   - Region: **West EU (Ireland)** ou **Central EU (Frankfurt)**
3. Espera 1–2 minutos até o projeto ficar pronto.

## 2. Criar as tabelas

1. No menu da esquerda: **SQL Editor** → **New query**
2. Abre o ficheiro `supabase/schema.sql` deste repositório, copia tudo e cola.
3. Carrega em **Run**. Deve aparecer "Success. No rows returned".

## 3. Login sem emails de confirmação (recomendado para o piloto)

O plano grátis só envia poucos emails por hora, o que pode bloquear inscrições no dia do lançamento.

1. **Authentication** → **Sign In / Providers** → **Email**
2. Desliga **Confirm email** → **Save**

## 4. Copiar as chaves para a app

1. **Project Settings** → **API** (ou **Data API**)
2. Copia o **Project URL** e a chave **anon public**.
3. Cola-as em `js/config.js`:

```js
window.PADEL_CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...'
};
```

A chave `anon` pode ficar pública: quem protege os dados são as regras do `schema.sql`.
**Nunca** uses a chave `service_role` na app.

## 5. Publicar

Faz commit e push. O GitHub Pages atualiza sozinho em 1–2 minutos.

O repositório chama-se `falta1`, por isso a app fica em `https://ramoshub-byte.github.io/falta1/`.

## Se já tinhas corrido o schema.sql antes

Corre o `supabase/schema.sql` outra vez, inteiro. É seguro: as tabelas que já existem ficam como estão e só são criadas a tabela `game_results` e as funções novas (`submit_result`, `confirm_result`, `confirmed_results`).

## O que fica protegido

- Cada pessoa só edita o seu próprio perfil.
- Os jogos só são visíveis para os 4 jogadores desse jogo.
- As avaliações individuais dos jogadores não são legíveis por ninguém. A app só recebe a fiabilidade agregada e o selo "✓ fiável".
- A localização é guardada arredondada a cerca de 1 km.
- Um resultado só pode ser confirmado por um jogador da outra equipa.
- Os resultados confirmados (quem jogou com quem e o resultado) são visíveis a todos os inscritos, porque alimentam o ranking. O feedback e as avaliações continuam privados.
