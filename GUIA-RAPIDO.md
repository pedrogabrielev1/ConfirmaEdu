# Configuração rápida do ConfirmaEdu

Você fará esta configuração somente uma vez. O projeto funciona no plano gratuito do Supabase e pode continuar hospedado no GitHub Pages.

## 1. Criar o banco

1. Acesse `https://supabase.com/dashboard` e entre na sua conta.
2. Clique em **New project**.
3. Escolha um nome, como `confirmaedu`, crie uma senha para o banco e finalize.
4. No menu do projeto, abra **SQL Editor**.
5. Clique em **New query**.
6. Abra o arquivo `database.sql`, copie todo o conteúdo e cole no editor.
7. Clique em **Run**. Deve aparecer uma mensagem de sucesso.

Não crie tabelas manualmente. O arquivo SQL já cria tudo.

## 2. Liberar cadastro por matrícula

1. No Supabase, abra **Authentication → Providers**.
2. Abra o provedor **Email**.
3. Deixe **Enable Email provider** ativado.
4. Desative a opção **Confirm email**.
5. Salve.

O ConfirmaEdu transforma internamente a matrícula em um identificador de autenticação. Nenhum e-mail real é solicitado ao aluno.

## 3. Conectar o site

1. No Supabase, abra **Project Settings → Data API** ou a tela **Connect** do projeto.
2. Copie a **Project URL**.
3. Copie a chave **Publishable**. Se essa opção não aparecer, copie a chave **anon public**.
4. Abra o arquivo `config.js` e substitua os dois textos:

```js
window.CONFIRMAEDU_CONFIG = {
  SUPABASE_URL: "SUA_PROJECT_URL",
  SUPABASE_KEY: "SUA_CHAVE_PUBLISHABLE_OU_ANON",
};
```

Nunca use a chave `service_role`.

## 4. Enviar ao GitHub

Envie todos estes arquivos para a raiz do repositório:

```text
index.html
style.css
script.js
config.js
database.sql
GUIA-RAPIDO.md
README.md
supabase.js
supabase-LICENSE.txt
qrcode.js
jsQR.js
jsQR-LICENSE.txt
```

Depois abra **Settings → Pages**, selecione **Deploy from a branch**, escolha `main` e `/root` e salve.

## 5. Criar os primeiros usuários

1. Abra o site publicado.
2. Clique em **Criar cadastro → Direção**.
3. O primeiro cadastro da direção será liberado automaticamente.
4. Alunos podem criar o próprio cadastro normalmente.
5. Usuários da cantina e outros usuários da direção ficarão aguardando aprovação.
6. Entre na primeira conta da direção e abra **Acessos** para aprová-los.

Pronto: os registros feitos em qualquer celular ou computador aparecerão para todos.
