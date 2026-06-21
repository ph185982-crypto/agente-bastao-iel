-- Execute no SQL Editor do Supabase

-- Usuários (identificados pelo número de WhatsApp)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transações (receitas e despesas)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
  valor NUMERIC(10, 2) NOT NULL,
  data DATE NOT NULL,
  descricao TEXT,
  categoria TEXT DEFAULT 'Outros',
  origem TEXT DEFAULT 'texto' CHECK (origem IN ('texto', 'comprovante')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contas fixas (recorrentes)
CREATE TABLE recurring_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  valor_estimado NUMERIC(10, 2),
  dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  categoria TEXT DEFAULT 'Outros',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pagamentos de contas fixas
CREATE TABLE bill_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_bill_id UUID REFERENCES recurring_bills(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  paid_at DATE NOT NULL,
  valor_pago NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para consultas rápidas
CREATE INDEX idx_transactions_user_data ON transactions(user_id, data);
CREATE INDEX idx_recurring_bills_user ON recurring_bills(user_id);
CREATE INDEX idx_bill_payments_bill_month ON bill_payments(recurring_bill_id, paid_at);

-- Row Level Security (só o serviço acessa via service key)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;
