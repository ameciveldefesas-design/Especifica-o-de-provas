
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";


const App = () => {
    // State for form fields
    const [processo, setProcesso] = useState('');
    const [requerente, setRequerente] = useState('');
    const [requerida, setRequerida] = useState('');
    const [objeto, setObjeto] = useState('');
    const [objetoLide, setObjetoLide] = useState('');

    // State for values
    const [valorImpugnado, setValorImpugnado] = useState('');
    const [danosMorais, setDanosMorais] = useState('');
    const [danosMateriais, setDanosMateriais] = useState('');
    const [repeticaoIndebito, setRepeticaoIndebito] = useState('');
    const [valorTotal, setValorTotal] = useState(0);

    // State for evidence type
    const [tipoProva, setTipoProva] =useState('oral');
    const [detalhesProva, setDetalhesProva] = useState('Requer-se a oitiva do preposto da empresa requerida, para esclarecer: ');

    // State for the generated report
    const [relatorioGerado, setRelatorioGerado] = useState('');
    const [copyButtonText, setCopyButtonText] = useState('Copiar');
    
    // State for AI processing
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState('');

    const parseCurrency = (value: string): number => {
        if (!value || typeof value !== 'string') return 0;
    
        // Keep only numbers, dots, and commas
        const s = String(value).replace(/[^0-9.,]/g, '');
        
        const commaIndex = s.lastIndexOf(',');
        const dotIndex = s.lastIndexOf('.');
    
        let sanitized;
    
        // If comma is present and is after the last dot, it's a decimal separator (Brazilian format)
        if (commaIndex > dotIndex) {
            // Format is 1.234,56 -> remove dots, replace comma with dot
            sanitized = s.replace(/\./g, '').replace(',', '.');
        } else {
            // Format is 1,234.56 or 1234.56 (US/JS format) -> remove commas
            sanitized = s.replace(/,/g, '');
        }
    
        return parseFloat(sanitized) || 0;
    };

    useEffect(() => {
        const total = [valorImpugnado, danosMorais, danosMateriais, repeticaoIndebito]
            .map(parseCurrency)
            .reduce((acc, curr) => acc + curr, 0);
        setValorTotal(total);
    }, [valorImpugnado, danosMorais, danosMateriais, repeticaoIndebito]);
    
    const fileToGenerativePart = (file: File): Promise<{ inlineData: { data: string, mimeType: string } }> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (typeof reader.result !== 'string') {
                    return reject(new Error("Failed to read file."));
                }
                const base64Data = reader.result.split(',')[1];
                resolve({
                    inlineData: {
                        data: base64Data,
                        mimeType: file.type
                    }
                });
            };
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(file);
        });
    }

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setError('');
        }
    };

    const handleExtractData = async () => {
        if (!file) {
            setError('Por favor, selecione um arquivo primeiro.');
            return;
        }

        setIsProcessing(true);
        setError('');

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const imagePart = await fileToGenerativePart(file);

            const prompt = `Analise o documento legal em anexo e extraia as seguintes informações no formato JSON.
- Se uma informação não for encontrada, retorne uma string vazia ("") para o campo correspondente.
- Para os campos de valores monetários (valorImpugnado, danosMorais, danosMateriais, repeticaoIndebito), siga estas regras de formatação rigorosamente:
  1. Localize o valor no formato de moeda brasileira (ex: "R$ 17.740,59").
  2. Remova o símbolo "R$", espaços e os pontos (.) que são separadores de milhar. O exemplo se torna "17740,59".
  3. Troque a vírgula (,) por um ponto (.). O exemplo se torna "17740.59".
  4. O resultado final deve ser uma string contendo apenas o número formatado desta maneira. Não faça nenhuma outra interpretação ou cálculo.
  5. Se o valor estiver escrito por extenso (ex: "dezessete mil e quarenta reais e cinquenta e nove centavos"), converta-o para o formato numérico "17040.59".
- Opine sobre o tipo de prova mais adequado ('oral' ou 'pericial') e forneça uma justificativa concisa baseada nos fatos do documento.`;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: { 
                    parts: [
                        { text: prompt },
                        imagePart
                    ]
                },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            processo: { type: Type.STRING, description: "Número do processo" },
                            requerente: { type: Type.STRING, description: "Nome completo do requerente (autor)" },
                            requerida: { type: Type.STRING, description: "Nome completo da requerida (réu)" },
                            objeto: { type: Type.STRING, description: "O assunto principal do processo (e.g., Ação declaratória de inexistência de débito)" },
                            objetoLide: { type: Type.STRING, description: "Um resumo conciso do objeto da lide, descrevendo a disputa principal." },
                            valorImpugnado: { type: Type.STRING, description: "Valor impugnado, se houver. Formatado como '12345.67'." },
                            danosMorais: { type: Type.STRING, description: "Valor de danos morais. Formatado como '12345.67'." },
                            danosMateriais: { type: Type.STRING, description: "Valor de danos materiais. Formatado como '12345.67'." },
                            repeticaoIndebito: { type: Type.STRING, description: "Valor de repetição do indébito. Formatado como '12345.67'." },
                            opiniaoProva: {
                                type: Type.OBJECT,
                                description: "Opinião sobre a prova mais interessante a ser seguida.",
                                properties: {
                                    tipo: { type: Type.STRING, description: "O tipo de prova recomendado ('oral' ou 'pericial')." },
                                    justificativa: { type: Type.STRING, description: "A justificativa para a escolha do tipo de prova." }
                                }
                            }
                        }
                    }
                }
            });
            
            const extractedData = JSON.parse(response.text);
            
            setProcesso(extractedData.processo || '');
            setRequerente(extractedData.requerente || '');
            setRequerida(extractedData.requerida || '');
            setObjeto(extractedData.objeto || '');
            setObjetoLide(extractedData.objetoLide || '');

            setValorImpugnado(extractedData.valorImpugnado || '');
            setDanosMorais(extractedData.danosMorais || '');
            setDanosMateriais(extractedData.danosMateriais || '');
            setRepeticaoIndebito(extractedData.repeticaoIndebito || '');

            if (extractedData.opiniaoProva) {
                setTipoProva(extractedData.opiniaoProva.tipo || 'oral');
                setDetalhesProva(extractedData.opiniaoProva.justificativa || '');
            }

        } catch (e) {
            console.error(e);
            setError('Falha ao extrair dados do documento. Verifique o arquivo, a complexidade do documento ou tente novamente.');
        } finally {
            setIsProcessing(false);
        }
    };


    const formatCurrency = (value: number | string) => {
        if (value === '' || value == null) return 'R$ 0,00';
        const numberValue = typeof value === 'string' 
            ? parseCurrency(value)
            : value;
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numberValue);
    };
    
    const handleTipoProvaChange = (novoTipo: 'oral' | 'pericial') => {
        setTipoProva(novoTipo);
        if (novoTipo === 'oral') {
            setDetalhesProva('Requer-se a oitiva do preposto da empresa requerida, para esclarecer: ');
        } else {
            setDetalhesProva('');
        }
    };

    const handleGenerateReport = () => {
        let provaSection = '';
        if (tipoProva === 'oral') {
            provaSection = `🗣 Prova Oral/Testemunhal:\n${detalhesProva || 'Não informado'}`;
        } else {
            provaSection = `🔎 Prova Pericial:\n${detalhesProva || 'Não informado'}`;
        }

        const report = `RELATÓRIO DE ESPECIFICAÇÃO DE PROVAS
Processo n.º: ${processo || 'Não informado'}
Requerente: ${requerente || 'Não informado'}
Requerida: ${requerida || 'Não informado'}
Objeto: ${objeto || 'Não informado'}

1. Objeto da Lide
${objetoLide || 'Não informado'}

2. 💰 Valor da Causa:
➡️ Valor impugnado: ${valorImpugnado ? formatCurrency(valorImpugnado) : '(não houver)'}
➡️ Valor pleiteado a título de danos morais: ${danosMorais ? formatCurrency(danosMorais) : '(não houver)'}
➡️ Valor pleiteado a título de danos materiais: ${danosMateriais ? formatCurrency(danosMateriais) : '(não houver)'}
➡️ Valor pleiteado a título de repetição do indébito: ${repeticaoIndebito ? formatCurrency(repeticaoIndebito) : '(não houver)'}
📌 Valor total atribuído à causa: ${formatCurrency(valorTotal)}

4. Opinião:
${provaSection}
`;
        setRelatorioGerado(report);
        setCopyButtonText('Copiar');
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(relatorioGerado).then(() => {
            setCopyButtonText('Copiado!');
            setTimeout(() => setCopyButtonText('Copiar'), 2000);
        });
    };
    
    const handleClear = () => {
        setProcesso('');
        setRequerente('');
        setRequerida('');
        setObjeto('');
        setObjetoLide('');
        setValorImpugnado('');
        setDanosMorais('');
        setDanosMateriais('');
        setRepeticaoIndebito('');
        setTipoProva('oral');
        setDetalhesProva('Requer-se a oitiva do preposto da empresa requerida, para esclarecer: ');
        setRelatorioGerado('');
        setFile(null);
        setError('');
    }

    return (
        <div className="app-container">
            <h1>Gerador de Relatório de Provas</h1>
            
            <div className="file-upload-section">
                <h2>Extração Automática com IA</h2>
                <p>Anexe um documento (PDF, DOCX, etc.) para preencher os campos automaticamente.</p>
                <div className="file-input-wrapper">
                    <label htmlFor="file-upload" className="file-input-label">
                        {file ? 'Trocar Arquivo' : 'Escolher Arquivo'}
                    </label>
                    <input id="file-upload" type="file" onChange={handleFileChange} accept=".pdf,.doc,.docx,image/*" />
                    {file && <span className="file-name">{file.name}</span>}
                </div>
                <button className="btn btn-ai" onClick={handleExtractData} disabled={!file || isProcessing}>
                    {isProcessing ? <div className="loader"></div> : 'Extrair Dados com IA'}
                </button>
                {error && <p className="error-message">{error}</p>}
            </div>

            <div className="form-grid">
                <div className="form-group">
                    <label htmlFor="processo">Processo n.º</label>
                    <input type="text" id="processo" value={processo} onChange={(e) => setProcesso(e.target.value)} />
                </div>
                <div className="form-group">
                    <label htmlFor="requerente">Requerente</label>
                    <input type="text" id="requerente" value={requerente} onChange={(e) => setRequerente(e.target.value)} />
                </div>
                <div className="form-group">
                    <label htmlFor="requerida">Requerida</label>
                    <input type="text" id="requerida" value={requerida} onChange={(e) => setRequerida(e.target.value)} />
                </div>
                <div className="form-group full-width">
                    <label htmlFor="objeto">Objeto</label>
                    <input type="text" id="objeto" value={objeto} onChange={(e) => setObjeto(e.target.value)} />
                </div>
            </div>

            <h2>1. Objeto da Lide</h2>
            <div className="form-group">
                <textarea id="objeto-lide" value={objetoLide} onChange={(e) => setObjetoLide(e.target.value)} placeholder="Descreva o objeto da lide..."></textarea>
            </div>

            <h2>2. Valor da Causa</h2>
            <div className="form-grid">
                 <div className="form-group">
                    <label htmlFor="valor-impugnado">Valor impugnado</label>
                    <input type="text" id="valor-impugnado" placeholder="0,00" value={valorImpugnado} onChange={(e) => setValorImpugnado(e.target.value)} />
                </div>
                 <div className="form-group">
                    <label htmlFor="danos-morais">Danos morais</label>
                    <input type="text" id="danos-morais" placeholder="0,00" value={danosMorais} onChange={(e) => setDanosMorais(e.target.value)} />
                </div>
                 <div className="form-group">
                    <label htmlFor="danos-materiais">Danos materiais</label>
                    <input type="text" id="danos-materiais" placeholder="0,00" value={danosMateriais} onChange={(e) => setDanosMateriais(e.target.value)} />
                </div>
                 <div className="form-group">
                    <label htmlFor="repeticao-indebito">Repetição do indébito</label>
                    <input type="text" id="repeticao-indebito" placeholder="0,00" value={repeticaoIndebito} onChange={(e) => setRepeticaoIndebito(e.target.value)} />
                </div>
                <div className="form-group full-width">
                    <label>Valor total atribuído à causa:</label>
                    <div className="total-value">{formatCurrency(valorTotal)}</div>
                </div>
            </div>

            <h2>3. Opinião (Tipo de Prova)</h2>
            <div className="radio-group">
                <label className="radio-label"><input type="radio" name="tipo-prova" value="oral" checked={tipoProva === 'oral'} onChange={() => handleTipoProvaChange('oral')} /> Prova Oral/Testemunhal</label>
                <label className="radio-label"><input type="radio" name="tipo-prova" value="pericial" checked={tipoProva === 'pericial'} onChange={() => handleTipoProvaChange('pericial')} /> Prova Pericial</label>
            </div>
            <div className="form-group">
                <label htmlFor="detalhes-prova" style={{marginTop: '1rem'}}>Detalhes</label>
                <textarea id="detalhes-prova" value={detalhesProva} onChange={(e) => setDetalhesProva(e.target.value)} placeholder="Especifique os detalhes da prova..."></textarea>
            </div>
            
            <div className="button-group">
                <button className="btn btn-primary" onClick={handleGenerateReport}>Gerar Relatório</button>
                <button className="btn btn-secondary" onClick={handleClear}>Limpar Campos</button>
            </div>

            {relatorioGerado && (
                <div className="report-output">
                    <div className="report-header">
                        <h2>Relatório Gerado</h2>
                        <button className="btn btn-copy" onClick={handleCopy}>{copyButtonText}</button>
                    </div>
                    <pre>{relatorioGerado}</pre>
                </div>
            )}

        </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
