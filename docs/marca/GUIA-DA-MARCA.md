# Guia rápido da marca Easylabor

**Nome:** Easylabor. **Assinatura:** Plataforma de Serviços.
**Conceito:** o símbolo (um "E" feito de três faixas fluidas e um ponto) representa o fluxo de solicitações e serviços, do
início ao fim.

## Cores (extraídas da imagem da marca)
| Nome | Hex | Uso |
| --- | --- | --- |
| Marinho | `#12304C` | Textos, menu lateral do painel, fundo do ícone e da abertura do app |
| Azul-claro | `#53B6D7` | Destaques, item ativo do menu, realces. Texto sobre ele: marinho |
| Verde | `#94BE45` | Sucesso e confirmações (selos usam o verde-escuro `#3E5F10` sobre `#EAF4D8`). **Não** usar texto branco sobre o verde: contraste 2,2:1 |
| Laranja | `#F3B844` | Ponto do símbolo, avisos e "aguardando" (selos: `#7A4A00` sobre `#FDF1D3`) |

Cores de interface derivadas: **azul de ação** `#1F6AAE` (botões e links; 5,6:1 com texto branco), texto secundário `#4A6076`,
linhas `#D3E4EE`, fundo `#F4F9FC`, erro `#B23A17`. Todos os pares de texto usados passam do mínimo de 4,5:1 (WCAG AA).

## Arquivos
- `simbolo.svg`: para fundo claro (a faixa de cima é azul-marinho).
- `simbolo-fundo-escuro.svg`: para fundo marinho (a faixa de cima clareia, senão ela some).
- No app: `apps/mobile/assets/` (ícone, ícone adaptativo do Android, abertura, símbolo). No painel: `apps/panel/public/` e `apps/panel/src/app/icon.svg`.

## Uso
- Margem livre ao redor do símbolo de pelo menos metade da largura do ponto laranja.
- Não alterar proporções, nem trocar as cores, nem aplicar sombras ou efeitos.
- Tipografia da interface: Outfit (pesos 400 a 800) no painel; fonte do sistema no app.

## Observação importante
Os símbolos desta pasta foram **redesenhados em vetor a partir da imagem recebida (baixa resolução)**. Ficaram muito próximos, mas
não são os arquivos originais. Para impressão, fachada, loja de aplicativos e registro da marca, use os arquivos originais do
designer (SVG ou PNG em alta resolução, versão positiva e negativa, e o logotipo com o nome) e substitua os daqui.
