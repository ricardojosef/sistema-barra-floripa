# Imagens da página inicial

Coloque os arquivos nesta pasta com **exatamente estes nomes**. Enquanto um
arquivo não existir, a página mostra um placeholder listrado escrito com o
nome esperado — nada quebra, e você pode trocar as fotos uma a uma.

Qualquer formato que o navegador entenda serve (`.jpg`, `.png`, `.webp`),
desde que o **nome e a extensão** batam com a tabela. Se preferir `.webp`,
troque também a extensão no `src` dentro do `index.html`.

| Arquivo | Onde aparece | Proporção sugerida | Observação |
|---|---|---|---|
| `hero.jpg` | Fundo do topo da página | 16:9 ou maior, **horizontal** | Mínimo 1920px de largura. Recebe um escurecimento por cima, então fotos claras funcionam bem. O texto fica à esquerda — evite elementos importantes desse lado. |
| `surf1.jpg` | Galeria "De zero a 13%" (foto de cima) | 4:3 horizontal | ~800px de largura basta |
| `surf2.jpg` | Galeria "De zero a 13%" (foto do meio) | 4:3 horizontal | |
| `surf3.jpg` | Galeria "De zero a 13%" (foto de baixo) | 4:3 horizontal | |
| `galera.jpg` | "Aprenda com quem tem experiência" | 4:3 horizontal | Foto da turma |
| `praia-da-barra.jpg` | Fundo da seção de localização | 16:9 horizontal | Mínimo 1600px. Também recebe escurecimento. |
| `local1.jpg` | Grade da localização (sup. esquerda) | 4:3 horizontal | ~600px cada |
| `local2.jpg` | Grade da localização (sup. direita) | 4:3 horizontal | |
| `local3.jpg` | Grade da localização (inf. esquerda) | 4:3 horizontal | |
| `local4.jpg` | Grade da localização (inf. direita) | 4:3 horizontal | |
| `avancado1.jpg` | "De da Barra" — foto grande | 4:3 horizontal | Onda grande / tubo |
| `avancado2.jpg` | "De da Barra" — miniatura esquerda | quadrada | Sobreposta à foto grande |
| `avancado3.jpg` | "De da Barra" — miniatura direita | quadrada | No site é o print da reportagem sobre a maior onda |
| `produto-pranchas.jpg` | Card "Pranchas" | **3:4 vertical** | Vira fundo do card, com escurecimento |
| `produto-equipamentos.jpg` | Card "Equipamentos" | **3:4 vertical** | |
| `produto-acessorios.jpg` | Card "Acessórios" | **3:4 vertical** | |
| `produto-roupas.jpg` | Card "Roupas" | **3:4 vertical** | |
| `depoimento1.jpg` … `depoimento7.jpg` | Carrossel "Quem conhece indica" | 4:3 horizontal | **Prints das avaliações do Google**, como no site atual. Exibidos inteiros (sem corte), então qualquer proporção funciona. |

**Total: 24 imagens** (17 da página + 7 prints de depoimento).

> Não há mais `de-da-barra.jpg` nem `pranchas.jpg`: a seção do fundador foi
> unida a "Níveis avançados" (como no site) e usa as três `avancado*.jpg`, e
> os produtos passaram a ter uma foto por card.

### Conferência rápida

Os 24 nomes exatos, para você copiar:

```
hero.jpg
surf1.jpg  surf2.jpg  surf3.jpg
galera.jpg
praia-da-barra.jpg
local1.jpg  local2.jpg  local3.jpg  local4.jpg
avancado1.jpg  avancado2.jpg  avancado3.jpg
produto-pranchas.jpg  produto-equipamentos.jpg
produto-acessorios.jpg  produto-roupas.jpg
depoimento1.jpg … depoimento7.jpg
```

## Dicas

- **Peso:** comprima antes de subir. Fotos acima de ~300 KB deixam a página
  lenta no celular. [squoosh.app](https://squoosh.app) resolve bem.
- **Recorte:** as imagens são exibidas com `object-fit: cover`, ou seja, elas
  preenchem o espaço e o excesso é cortado nas bordas. Deixe o assunto
  principal no centro.
- **Nomes:** tudo em minúsculas, sem espaços e sem acentos — isso evita
  problemas no GitHub Pages, que diferencia maiúsculas de minúsculas.

## Reaproveitando as fotos do site atual

As imagens do site oficial estão em
`barrafloripasurfschool.com.br/wp-content/uploads/`. Se forem suas, basta
baixá-las e renomear conforme a tabela. Os nomes originais correspondentes:

| Original | Renomeie para |
|---|---|
| `surf1-1.webp`, `surf2-1.webp`, `surf3-1.webp` | `surf1.jpg`, `surf2.jpg`, `surf3.jpg` |
| `barrafloripa-galera-1.webp` | `galera.jpg` |
| `praiadabarra-pic-2.webp` | `praia-da-barra.jpg` |
| `foto4-surf-1.webp`, `foto5-surf-1-1.webp`, `foto6surf-1.webp` | `avancado1.jpg`, `avancado2.jpg`, `avancado3.jpg` |
| `surfer.png` | `de-da-barra.jpg` |
| `photo_2026-01-04_10-55-59.webp` e os outros 6 `photo_2026-01-04_*` | `depoimento1.jpg` … `depoimento7.jpg` |
