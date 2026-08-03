-- A categoria chama-se Iniciante em todo o resto do sistema (CategoriaVendedor,
-- histórico de categoria, telas de vendedor). O enum das tabelas de comissão
-- nasceu com NOVATO; aqui ele passa a usar o mesmo nome.
--
-- RENAME VALUE preserva as linhas já gravadas: nenhuma tabela de comissão
-- precisa ser recadastrada.
ALTER TYPE "DestinoComissao" RENAME VALUE 'NOVATO' TO 'INICIANTE';
