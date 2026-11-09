# Meu caderno para PC (Tauri)

Este projeto empacota o site (pasta `dist/`) como um programa de Windows (também gera Linux e macOS).
O código do app é o mesmo HTML, CSS e JavaScript. O Tauri só abre ele numa janela própria,
com ícone, instalador e sem barra de navegador. O instalador fica em torno de 2 a 3 MB.

## Jeito mais fácil: GitHub gera o instalador (nada para instalar no PC)

1. Crie um repositório **privado** no GitHub e envie todo o conteúdo desta pasta.
2. No repositório, abra **Actions > Gerar instalador do Windows > Run workflow**.
3. Espere uns 6 a 10 minutos. Na execução concluída, baixe o arquivo **meu-caderno-windows**
   (um zip com o instalador `.exe`).
4. Abra o `.exe`. O Windows pode avisar "O Windows protegeu o computador" porque o instalador
   não é assinado. Clique em **Mais informações > Executar assim mesmo**. É seu próprio programa.

## Jeito local (no seu Windows)

Instale uma vez: Node.js 20+, Rust (https://rustup.rs) e as "Ferramentas de Build do Visual Studio"
com a carga **Desenvolvimento para desktop com C++**. O WebView2 já vem no Windows 10/11.

```
npm install
npm run build
```

O instalador sai em `src-tauri\target\release\bundle\nsis\`.
Para testar sem instalar: `npm run dev`.

## Dados

- Os dados do programa ficam separados dos do site/PWA do Netlify e dos de cada navegador.
- Para levar o que você já tem: no app antigo, vá em **Conta e backup > Exportar backup** e, no
  programa novo, **Importar backup**. Se usar a sincronização (Supabase), é só entrar com a mesma conta.
- Desinstalar o programa não apaga os dados da pasta do usuário. Faça backup de vez em quando.

## Atualizar o app

Altere os arquivos em `dist/` (são os mesmos do site do Netlify), gere o instalador de novo e instale
por cima. Os dados continuam. Troque a versão em `src-tauri/tauri.conf.json` e `package.json` se quiser.

## O que há aqui

- `dist/`: o site (HTML, CSS, JS). O service worker fica desligado no programa, porque os arquivos já vão dentro dele.
- `src-tauri/`: configuração do Tauri (janela, segurança, ícones) e o pequeno `main.rs`.
- `.github/workflows/`: receita para o GitHub gerar o instalador.
