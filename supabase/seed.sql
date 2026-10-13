-- Dados iniciais da oficina. Serviços e horário vêm do Instagram @masterscootermotos (a confirmar com a oficina).
-- Durações, boxes, capacidade e lista de sintomas de risco são estimativas da Sena SERVUS, a validar com a equipe.

insert into public.horarios_funcionamento (dia_semana, abre, fecha) values
  (1, '08:00', '18:00'), (2, '08:00', '18:00'), (3, '08:00', '18:00'), (4, '08:00', '18:00'), (5, '08:00', '18:00'),
  (6, '08:00', '14:00');

insert into public.recursos (nome) values ('Box 1'), ('Box 2');

insert into public.servicos (slug, nome, itens, duracao_minutos, ordem) values
  ('revisao-geral', 'Revisão geral', array['Reaperto e lubrificação em geral', 'Verificação do alarme e pneus', 'Conferência da suspensão dianteira'], 120, 1),
  ('motor', 'Motor', array['Troca do óleo do motor', 'Troca do filtro de óleo', 'Troca de vela', 'Limpeza de bico e carburador'], 60, 2),
  ('transmissao-cvt', 'Transmissão (CVT)', array['Troca da correia do CVT', 'Troca de roletes e embreagem', 'Lubrificação do sistema'], 120, 3),
  ('freios', 'Freios', array['Troca de pastilha e lona de freio', 'Troca de disco de freio', 'Limpeza do sistema de freio'], 60, 4),
  ('parte-eletrica', 'Parte elétrica', array['Troca de bateria', 'Troca de lâmpadas', 'Teste de iluminação'], 60, 5),
  ('diagnostico-scanner', 'Diagnóstico com scanner', array['Leitura de códigos de falha', 'Análise completa'], 60, 6);

insert into public.sintomas (slug, texto, risco) values
  ('freio-fraco', 'Freio fraco, esponjoso ou rangendo', true),
  ('combustivel', 'Cheiro ou vazamento de combustível', true),
  ('direcao-instavel', 'Guidão ou direção instável', true),
  ('nao-liga', 'Moto não liga', false),
  ('luz-painel', 'Luz de aviso acesa no painel', false),
  ('ruido', 'Barulho diferente no motor ou na transmissão', false),
  ('falhando', 'Falhando ou engasgando', false),
  ('consumo-alto', 'Consumo de combustível alto', false);
