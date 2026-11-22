# Falta 1 — POC (piloto Chaves)

Diz à app que queres jogar, sozinho ou com o teu parceiro. Ela junta os 4 jogadores pelo nível, lado, horário e distância, e depois propõe o campo num mapa.

## Como experimentar

Abre `index.html` no browser (duplo clique). Sem configuração, a app corre em **modo demonstração**, com jogadores fictícios. O mapa precisa de internet.

Para o piloto real, com contas, convites e feedback partilhados, segue o [SETUP.md](SETUP.md): Supabase e depois GitHub Pages.

## Documentação

Análises e decisões ficam em [`docs/`](docs/README.md): o marcador ao vivo, os custos de uma app de relógio e a integração com apps de marcador.

## O que está feito

- **Perfil:** nome, nível 0–7, lado preferido, horários da semana, localização no mapa e distância máxima
- **Jogar:** modo sozinho ou com parceiro, e até 3 jogos propostos com as equipas e o equilíbrio entre elas
- **Campo:** mapa com os 4 jogadores e os clubes, com os clubes ao alcance de todos ordenados por distância
- **Os meus jogos:** jogos propostos, com o link para reservar no Playtomic
- **Marcador no telemóvel:** um toque por ponto, com ponto de ouro ou vantagens, tie-break a 7 e super tie-break a 10 no 3.º set. Tem botão de anular, o ecrã fica aceso e o marcador sobrevive a um recarregar da página. Também dá para escrever o resultado à mão.
  - **quem serve e de que lado:** escolhe-se quem serve primeiro em cada equipa; a app roda o serviço pelos 4 (no tie-break, 1-2-2) e diz se é da direita ou da esquerda
  - **troca de lado:** aviso grande (e vibração) depois dos jogos ímpares, a cada 6 pontos no tie-break e no fim dos sets com número ímpar de jogos
  - **horizontal e ecrã inteiro:** ao rodar o telemóvel, os botões ficam lado a lado; botão de ecrã inteiro onde o browser deixa (Android/computador; no iPhone, a app instalada já ocupa o ecrã)
  - **ao vivo:** cada ponto é enviado para o ecrã do clube e para um link (🔗) que se partilha com quem está a ver; pode desligar-se antes de começar
- **Confirmação do resultado:** uma equipa regista e a outra confirma ou contesta. Só os resultados confirmados contam.
- **Nível calculado pelos jogos (`js/rating.js`):** Elo adaptado a pares, mostrado na escala 0–7
  - o nível do perfil é a autoavaliação inicial; depois do primeiro resultado confirmado, o matchmaking passa a usar o nível calculado
  - K = 48 nos primeiros 10 jogos, 32 até 30 jogos e 16 depois; vitórias folgadas valem até 1,5×
  - cada **parelha** tem rating próprio; a **química** é a diferença entre o nível da parelha e a média dos dois
- **Ranking:** jogadores (com tendência dos últimos jogos e marca de "provisório" abaixo de 5 jogos) e parelhas com química
- **Feedback pós-jogo:** estrelas ao clube (limpeza, balneários, serviços), se o nível foi equilibrado, como correu, e perguntas sim/não sobre cada jogador (pontual, fair play, voltava a jogar)
  - os jogadores pouco fiáveis passam a ser emparelhados longe dos fiáveis; o número nunca é mostrado, só o selo "✓ fiável"
  - os clubes bem avaliados ganham o desempate de distância
  - "fácil demais" / "difícil demais" fica guardado mas já não mexe no nível (agora são os resultados que o fazem)
- **Época (ranking do ano, `js/season.js`):** recomeça em janeiro e é separada do nível
  - jogo casual: vitória 10 pontos, derrota 3; +5 de bónus a quem ganha com menos de 40% de probabilidade
  - contra os mesmos 4 jogadores só contam 2 jogos por semana para os pontos
  - torneio, pela posição final: campeão 60, finalista 40, meias 25, quartos 15, participação 10
  - divisões A (nível 4,5 ou mais), B (3 a 4,49) e C (abaixo de 3), fixas na época; quem começa com menos de 5 jogos fica na divisão do nível que tiver ao 5.º jogo
  - destaques (mais vitórias, mais jogos) e a explicação do cálculo no rodapé, gerada a partir das mesmas regras que fazem as contas
- **Torneios (`js/tournament.js`):** americano (individual, parceiros a rodar), grupos + eliminatórias, e eliminatória
  - o organizador escolhe os participantes e o formato, e se a app **sugere pelo ranking** (duplas e jogos equilibrados, cabeças de série) ou **sorteia**
  - nunca se repetem duplas dentro do torneio (nas eliminatórias podem voltar a encontrar-se); nas duplas, o organizador pode trocar à mão
  - distribui os jogos pelos campos e pelas rondas, e diz quem descansa
  - quem joga regista o resultado e alguém da outra equipa confirma ou contesta (o organizador, se não jogar nesse jogo, pode registar ou validar); só os confirmados contam
  - as classificações, os grupos e a chave atualizam-se sozinhos
  - ao terminar o torneio, as posições contam na época; os jogos contam no nível
- **Ecrã do clube (`ecra.html`):** página pública para uma TV, sem conta
  - roda entre o ranking da época (as 3 divisões lado a lado), o torneio a decorrer (classificação e próximos jogos, ou o pódio) e os destaques
  - atualiza a cada minuto; `?clube=cpc` mostra só os torneios desse clube, `&seg=20` muda o tempo de cada ecrã, `&so=ranking` fixa um ecrã
  - **ao vivo:** quando há jogos a ser marcados, aparece primeiro o ecrã "Ao vivo" (até 4 jogos, atualiza a cada 5 s, com quem serve e as trocas de lado)
  - `ecra.html?jogo=ID` mostra só esse jogo, em grande e também em telemóvel: é o link do botão 🔗 do marcador
  - mostra só o primeiro nome e a inicial; quem desligar a opção no perfil aparece como "Jogador"
- **Modo demonstração:** 24 jogadores fictícios de Chaves, 48 resultados fictícios (set–nov 2026) e um americano fictício já jogado, para o ranking não começar vazio

## Estrutura

```
index.html            app (PWA)
css/styles.css
js/data.js            clubes de Chaves + jogadores de teste
js/matchmaking.js     motor de matchmaking
js/rating.js          nível (Elo para pares, rating de parelha, química)
js/scorer.js          marcador de padel (regras, anular, resultado escrito à mão)
js/season.js          época: pontos, divisões, desempates e explicação do cálculo
js/tournament.js      torneios: americano, grupos + eliminatórias, eliminatória
js/ecra.js            ecrã do clube (ecra.html + css/ecra.css)
js/app.js             ecrãs
js/backend.js         dados: modo demonstração (localStorage) ou Supabase
js/config.js          chaves do Supabase (vazio = demonstração)
supabase/schema.sql   tabelas, regras de segurança e funções (inclui live_scores, o marcador ao vivo)
manifest.webmanifest  instalação no telemóvel
sw.js                 funcionamento offline
docs/                 documentação, análises e capturas de ecrã
tests/                node tests/<nome>.test.js — matchmaking, rating, scorer, season, tournament
```

## Fluxo de um jogo (modo Supabase)

1. Alguém pede jogo, escolhe o campo e propõe. Os outros 3 recebem o convite em "Os meus jogos", e quem propôs pode avisá-los por WhatsApp.
2. Cada um aceita ou recusa. Quando os 4 aceitam, o jogo fica **confirmado**. Se alguém recusar, fica **recusado** e procura-se outro jogo.
3. Um dos jogadores reserva o campo no Playtomic.
4. No dia do jogo, alguém abre o **marcador** (ou escreve o resultado). A outra equipa confirma ou contesta. Se contestar, qualquer equipa pode registar outra vez.
5. Com o resultado confirmado, o jogo passa a **jogado** e o nível dos 4 e das 2 parelhas atualiza.
6. Cada um dá o feedback (clube e jogadores).

## Limitações do POC

- As coordenadas dos clubes são aproximadas e têm de ser confirmadas.
- A reserva é feita fora da app, no Playtomic.
- Não há notificações push: os avisos vão por WhatsApp e cada um abre "Os meus jogos".
- O nível é calculado no telemóvel de cada um a partir dos resultados confirmados (iguais para todos). Com muitos jogadores, passa para o servidor.
- Ainda não há marcador no relógio (Apple Watch / Wear OS): fica para a fase 2.
- Nas eliminatórias, as equipas de cada jogo são calculadas pela app; o servidor confirma que quem regista está no jogo, mas não refaz a chave.
