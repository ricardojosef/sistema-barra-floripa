# Imagens da página inicial

**No estado atual, todas as 23 imagens do `index.html` apontam direto para o
site oficial** (`barrafloripasurfschool.com.br/wp-content/uploads/2026/01/…`).
A página já abre com as fotos reais — esta pasta está aqui para quando você
quiser hospedar as imagens junto com o projeto.

## Quando vale trazer as imagens para cá

Apontar para o site atual funciona, mas cria uma dependência: se aquele site
sair do ar, mudar de endereço ou alguém apagar um arquivo, a página quebra.
Além disso, cada visitante baixa as fotos de outro domínio, o que costuma ser
um pouco mais lento.

Para tornar o projeto independente, baixe os arquivos e troque os `src`.

## Lista completa

Base: `https://barrafloripasurfschool.com.br/wp-content/uploads/2026/01/`

| Onde aparece | Arquivo no site oficial | Nome sugerido aqui |
|---|---|---|
| Fundo do hero | `bg-barra-02-1-1.webp` | `hero.webp` |
| Galeria "De zero a 100%" (3 fotos) | `surf1-1.webp`, `surf2-1.webp`, `surf3-1.webp` | `surf1.webp`, `surf2.webp`, `surf3.webp` |
| "Aprenda com quem tem experiência" | `barrafloripa-galera-1.webp` | `galera.webp` |
| Fundo da seção de localização | `newpraiabarra-1.webp` | `praia-fundo.webp` |
| Bloco de fotos da localização | `praiadabarra-pic-2.webp` | `praia-da-barra-fotos.webp` |
| "De da Barra" — foto grande | `foto4-surf-1.webp` | `avancado1.webp` |
| "De da Barra" — miniatura 1 | `foto5-surf-1-1.webp` | `avancado2.webp` |
| "De da Barra" — miniatura 2 | `foto6surf-1.webp` | `avancado3.webp` |
| Card "Pranchas" | `new-pranchas-1.webp` | `produto-pranchas.webp` |
| Card "Equipamentos" | `equipamentos-card-1.webp` | `produto-equipamentos.webp` |
| Card "Acessórios" | `acessorios-card-1-1.webp` | `produto-acessorios.webp` |
| Card "Roupas" | `roupas-card-1-1.webp` | `produto-roupas.webp` |
| Depoimentos (7 prints) | `photo_2026-01-04_10-55-59.webp`, `…_10-56-00.webp`, `…_10-56-00-2.webp`, `…_10-56-01.webp`, `…_10-56-02.webp`, `…_10-56-02-2.webp`, `…_10-56-03.webp` | `depoimento1.webp` … `depoimento7.webp` |

**Total: 23 imagens.**

> O bloco de fotos da localização (`praiadabarra-pic-2.webp`, 717×493) é uma
> **imagem única já composta com as quatro fotos** — não são quatro arquivos
> separados montados em CSS.

## Como baixar todas de uma vez

No Git Bash, dentro desta pasta:

```bash
B="https://barrafloripasurfschool.com.br/wp-content/uploads/2026/01"

curl -O "$B/bg-barra-02-1-1.webp"
curl -O "$B/surf1-1.webp"  && curl -O "$B/surf2-1.webp" && curl -O "$B/surf3-1.webp"
curl -O "$B/barrafloripa-galera-1.webp"
curl -O "$B/newpraiabarra-1.webp"
curl -O "$B/praiadabarra-pic-2.webp"
curl -O "$B/foto4-surf-1.webp" && curl -O "$B/foto5-surf-1-1.webp" && curl -O "$B/foto6surf-1.webp"
curl -O "$B/new-pranchas-1.webp" && curl -O "$B/equipamentos-card-1.webp"
curl -O "$B/acessorios-card-1-1.webp" && curl -O "$B/roupas-card-1-1.webp"
for h in 10-55-59 10-56-00 10-56-00-2 10-56-01 10-56-02 10-56-02-2 10-56-03; do
  curl -O "$B/photo_2026-01-04_$h.webp"
done
```

Depois, no `index.html`, troque o prefixo das URLs por `img/`:

```
https://barrafloripasurfschool.com.br/wp-content/uploads/2026/01/  →  img/
```

Os nomes dos arquivos continuam os mesmos, então é só uma substituição de
texto. Se renomear para os "nomes sugeridos" da tabela, ajuste os `src` de
acordo.

## Se faltar alguma imagem

Toda `<figure>` e todo card de produto tem um `onerror` que troca a foto por
um placeholder listrado com o nome do arquivo esperado. A página nunca quebra
por causa de uma imagem ausente.

## Dicas

- **Peso:** comprima antes de subir. Acima de ~300 KB a página fica lenta no
  celular. [squoosh.app](https://squoosh.app) resolve bem.
- **Recorte:** as fotos são exibidas com `object-fit: cover` — preenchem o
  espaço e o excesso é cortado nas bordas. Deixe o assunto no centro.
- **Nomes:** minúsculas, sem espaços e sem acentos. O GitHub Pages diferencia
  maiúsculas de minúsculas, e isso evita links quebrados.
