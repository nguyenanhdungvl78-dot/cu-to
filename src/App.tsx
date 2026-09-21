import React, { useState, useMemo, useRef, useEffect } from 'react';
import { FileSpreadsheet, FileText, Settings, Plus, Trash2, Printer, Download, Sparkles, Upload, Brain, Eye, EyeOff, RefreshCw, Save } from 'lucide-react';
import * as mammoth from 'mammoth';
import { GoogleGenAI, Type } from "@google/genai";
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const MathMarkdown = ({ content }: { content: string }) => (
  <div className="markdown-body prose max-w-none">
    <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {content}
    </Markdown>
  </div>
);

// --- Types ---
type Level = 'biet' | 'hieu' | 'vandung';
type QuestionType = 'nlc' | 'ds' | 'tln' | 'tl';

interface MatrixData {
  nlc: Record<Level, number>;
  ds: Record<Level, number>;
  tln: Record<Level, number>;
  tl: Record<Level, number>;
}

interface Topic {
  id: string;
  name: string;
  content: string;
  lessons: number;
  requirements: Record<Level, string>;
  rawRequirements?: string;
  matrix: MatrixData;
}

interface GeneratedQuestion {
  id: string;
  topicId?: string;
  topicName?: string;
  levelName?: string;
  type: QuestionType;
  level?: Level;
  content: string;
  options?: string[]; // For nlc
  correctAnswer: string;
  explanation?: string;
}

interface Exam {
  id: string;
  title: string;
  questions: GeneratedQuestion[];
  createdAt: string;
}

// --- Constants & Defaults ---
const POINTS = { nlc: 0.25, ds: 1.0, tln: 0.5, tl: 1.0 };

const VERB_DICT = {
  biet: ['đọc', 'đếm', 'viết', 'làm quen', 'nhận dạng', 'nhận biết'],
  hieu: ['mô tả', 'giải thích', 'thể hiện', 'sắp xếp'],
  vandung: ['tính', 'vẽ', 'thực hiện', 'sử dụng', 'vận dụng', 'so sánh', 'phân biệt', 'lí giải', 'chứng minh', 'giải quyết', 'giải']
};

const classifyText = (text: string): Level => {
  let lower = text.toLowerCase().trim();
  
  if (lower.includes('vd ') || lower.includes('vd:') || lower.startsWith('vd')) {
      return 'vandung';
  }

  lower = lower.replace(/^[-+*.\s]+/, '');
  lower = lower.replace(/^(vd|ví dụ)[\s:]*/, '');

  for (const [level, verbs] of Object.entries(VERB_DICT)) {
    if (verbs.some(v => lower.startsWith(v))) return level as Level;
  }
  
  const firstWords = lower.split(' ').slice(0, 8).join(' ');
  for (const [level, verbs] of Object.entries(VERB_DICT)) {
    if (verbs.some(v => firstWords.includes(v))) return level as Level;
  }
  
  return 'vandung';
};

const autoClassifyRequirements = (rawReqs: string) => {
  // Thay thế các gạch đầu dòng dính liền thành xuống dòng
  let processedReqs = rawReqs.replace(/\s+([-+*–])\s/g, '\n$1 ');
  
  // Thêm xuống dòng trước các động từ nếu nó nằm sau dấu chấm
  processedReqs = processedReqs.replace(/\.\s+(Nhận biết|Nhận dạng|Đọc|Đếm|Viết|Làm quen|Mô tả|Giải thích|Thể hiện|Sắp xếp|Tính|Vẽ|Thực hiện|Sử dụng|Vận dụng|So sánh|Phân biệt|Lí giải|Chứng minh|Giải quyết|VD)/gi, '.\n$1');

  const lines = processedReqs.split('\n');
  const categorized: Record<Level, string[]> = { biet: [], hieu: [], vandung: [] };
  let currentReq = '';
  const reqs: string[] = [];

  const startsWithVerb = (text: string) => {
      const lower = text.toLowerCase().replace(/^[-+*.\s]+/, '');
      return Object.values(VERB_DICT).flat().some(v => lower.startsWith(v));
  };

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    const isNewBullet = /^[-+*–]/.test(trimmed) || /^\d+\./.test(trimmed) || startsWithVerb(trimmed);

    if (isNewBullet) {
      if (currentReq) reqs.push(currentReq);
      currentReq = trimmed;
    } else {
      if (currentReq) currentReq += ' ' + trimmed;
      else currentReq = trimmed;
    }
  });
  if (currentReq) reqs.push(currentReq);

  reqs.forEach(req => {
     const level = classifyText(req);
     let formattedReq = req.trim();
     if (!/^[-+*–]/.test(formattedReq) && !/^\d+\./.test(formattedReq)) {
         formattedReq = '- ' + formattedReq;
     } else if (formattedReq.startsWith('-') && !formattedReq.startsWith('- ')) {
         formattedReq = '- ' + formattedReq.substring(1).trim();
     } else if (formattedReq.startsWith('–')) {
         formattedReq = '- ' + formattedReq.substring(1).trim();
     }
     categorized[level].push(formattedReq);
  });

  return {
    biet: categorized.biet.join('\n'),
    hieu: categorized.hieu.join('\n'),
    vandung: categorized.vandung.join('\n')
  };
};

const DEFAULT_DATA: Topic[] = [
  {
    id: '1',
    name: 'Đa thức',
    content: 'Đa thức nhiều biến. Các phép toán cộng, trừ, nhân, chia các đa thức nhiều biến',
    lessons: 8,
    requirements: {
      biet: '- Nhận biết được các khái niệm về đơn thức, đa thức nhiều biến.',
      hieu: '- Tính được giá trị của đa thức khi biết giá trị của các biến.\n- Thực hiện được việc thu gọn đơn thức, đa thức.\n- Thực hiện được phép nhân, chia đa thức.',
      vandung: ''
    },
    matrix: {
      nlc: { biet: 4, hieu: 0, vandung: 0 },
      ds: { biet: 1, hieu: 0, vandung: 0 },
      tln: { biet: 0, hieu: 1, vandung: 0 },
      tl: { biet: 0, hieu: 0, vandung: 0 }
    }
  },
  {
    id: '2',
    name: 'Hằng đẳng thức đáng nhớ và ứng dụng',
    content: 'Các hằng đẳng thức đáng nhớ. Phân tích đa thức thành nhân tử',
    lessons: 7,
    requirements: {
      biet: '- Nhận biết được các khái niệm: đồng nhất thức, hằng đẳng thức.',
      hieu: '- Mô tả được các hằng đẳng thức: bình phương của tổng và hiệu; hiệu hai bình phương; lập phương của tổng và hiệu; tổng và hiệu hai lập phương.',
      vandung: '- Vận dụng được các hằng đẳng thức để phân tích đa thức thành nhân tử ở dạng vận dụng trực tiếp hằng đẳng thức; vận dụng hằng đẳng thức thông qua nhóm hạng tử và đặt nhân tử chung.'
    },
    matrix: {
      nlc: { biet: 3, hieu: 0, vandung: 0 },
      ds: { biet: 0, hieu: 1, vandung: 0 },
      tln: { biet: 0, hieu: 1, vandung: 0 },
      tl: { biet: 0, hieu: 0, vandung: 1 }
    }
  },
  {
    id: '3',
    name: 'Tứ giác',
    content: 'Tứ giác. Hình thang cân, hình bình hành, hình chữ nhật, hình thoi và hình vuông',
    lessons: 9,
    requirements: {
      biet: '- Nhận biết được dấu hiệu để một hình thang là hình thang cân.\n- Nhận biết được dấu hiệu để một tứ giác là hình bình hành.\n- Nhận biết được dấu hiệu để một hình bình hành là hình chữ nhật.\n- Nhận biết được dấu hiệu để một hình bình hành là hình thoi.\n- Nhận biết được dấu hiệu để một hình chữ nhật là hình vuông.',
      hieu: '- Mô tả được tứ giác, tứ giác lồi.\n- Giải thích được định lí về tổng các góc trong một tứ giác lồi bằng 360o.\n- Giải thích được tính chất về góc kề một đáy, cạnh bên, đường chéo của hình thang cân.\n- Giải thích được tính chất về cạnh đối, góc đối, đường chéo của hình bình hành.\n- Giải thích được tính chất về hai đường chéo của hình chữ nhật.\n- Giải thích được tính chất về đường chéo của hình thoi.\n- Giải thích được tính chất về hai đường chéo của hình vuông.',
      vandung: ''
    },
    matrix: {
      nlc: { biet: 5, hieu: 0, vandung: 0 },
      ds: { biet: 0, hieu: 0, vandung: 0 },
      tln: { biet: 0, hieu: 1, vandung: 0 },
      tl: { biet: 0, hieu: 0, vandung: 0 }
    }
  },
  {
    id: '4',
    name: 'Định lý Thales',
    content: 'Định lý Talet trong tam giác. Đường trung bình của tam giác',
    lessons: 5,
    requirements: {
      biet: '',
      hieu: '- Giải thích được định lí Thalès trong tam giác (định lí thuận và đảo).\n- Giải thích được tính chất đường phân giác trong của tam giác.\n- Mô tả được định nghĩa đường trung bình của tam giác.\n- Giải thích được tính chất đường trung bình của tam giác.',
      vandung: '- Tính được độ dài đoạn thẳng bằng cách sử dụng định lí Thalès.\n- Giải quyết được một số vấn đề thực tiễn gắn với việc vận dụng định lí Thalès.'
    },
    matrix: {
      nlc: { biet: 0, hieu: 0, vandung: 0 },
      ds: { biet: 0, hieu: 0, vandung: 0 },
      tln: { biet: 0, hieu: 0, vandung: 0 },
      tl: { biet: 0, hieu: 0, vandung: 2 }
    }
  },
  {
    id: '5',
    name: 'Dữ liệu và biểu đồ',
    content: 'Thu thập, phân loại, tổ chức dữ liệu theo tiêu chí cho trước',
    lessons: 1,
    requirements: {
      biet: '',
      hieu: '- Thực hiện và lí giải được việc thu thập, phân loại dữ liệu theo các tiêu chí cho trước từ nhiều nguồn khác nhau.',
      vandung: '- Chứng tỏ được tính hợp lí của dữ liệu theo các tiêu chí toán học đơn giản.'
    },
    matrix: {
      nlc: { biet: 0, hieu: 0, vandung: 0 },
      ds: { biet: 0, hieu: 0, vandung: 0 },
      tln: { biet: 0, hieu: 1, vandung: 0 },
      tl: { biet: 0, hieu: 0, vandung: 0 }
    }
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'input' | 'matrix' | 'spec' | 'exam'>('matrix');
  const [selectedGrade, setSelectedGrade] = useState<number>(6);
  
  const [topicsByGrade, setTopicsByGrade] = useState<Record<number, Topic[]>>(() => {
    const saved = localStorage.getItem('exam_topics_by_grade_v3');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved topics', e);
      }
    }
    // Migrate from v2 if exists
    const savedV2 = localStorage.getItem('exam_topics_data_v2');
    const defaultTopics = savedV2 ? JSON.parse(savedV2) : DEFAULT_DATA;
    return {
      6: defaultTopics,
      7: DEFAULT_DATA,
      8: DEFAULT_DATA,
      9: DEFAULT_DATA
    };
  });

  const topics = topicsByGrade[selectedGrade] || [];
  
  const setTopics = (updater: Topic[] | ((prev: Topic[]) => Topic[])) => {
    setTopicsByGrade(prev => {
      const currentTopics = prev[selectedGrade] || [];
      const newTopics = typeof updater === 'function' ? updater(currentTopics) : updater;
      const newState = { ...prev, [selectedGrade]: newTopics };
      localStorage.setItem('exam_topics_by_grade_v3', JSON.stringify(newState));
      return newState;
    });
  };

  const [exam, setExam] = useState<Exam | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [modalConfig, setModalConfig] = useState<{ isOpen: boolean, title: string, message: string, onConfirm?: () => void, isAlert?: boolean }>({ isOpen: false, title: '', message: '' });

  const showAlert = (title: string, message: string) => {
    setModalConfig({ isOpen: true, title, message, isAlert: true });
  };

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setModalConfig({ isOpen: true, title, message, onConfirm, isAlert: false });
  };

  const closeModal = () => {
    setModalConfig({ ...modalConfig, isOpen: false });
  };

  // --- Calculations ---
  const totals = useMemo(() => {
    const t = {
      nlc: { biet: 0, hieu: 0, vandung: 0, total: 0, points: 0, pointsPerLevel: { biet: 0, hieu: 0, vandung: 0 } },
      ds: { biet: 0, hieu: 0, vandung: 0, total: 0, points: 0, pointsPerLevel: { biet: 0, hieu: 0, vandung: 0 } },
      tln: { biet: 0, hieu: 0, vandung: 0, total: 0, points: 0, pointsPerLevel: { biet: 0, hieu: 0, vandung: 0 } },
      tl: { biet: 0, hieu: 0, vandung: 0, total: 0, points: 0, pointsPerLevel: { biet: 0, hieu: 0, vandung: 0 } },
      all: { biet: 0, hieu: 0, vandung: 0, totalQs: 0, totalPoints: 0, pointsPerLevel: { biet: 0, hieu: 0, vandung: 0 } }
    };

    topics.forEach(topic => {
      (['nlc', 'ds', 'tln', 'tl'] as QuestionType[]).forEach(qt => {
        (['biet', 'hieu', 'vandung'] as Level[]).forEach(lvl => {
          const count = topic.matrix[qt][lvl] || 0;
          const pts = count * POINTS[qt];
          t[qt][lvl] += count;
          t[qt].total += count;
          t[qt].points += pts;
          t[qt].pointsPerLevel[lvl] += pts;
          
          t.all[lvl] += count;
          t.all.totalQs += count;
          t.all.totalPoints += pts;
          t.all.pointsPerLevel[lvl] += pts;
        });
      });
    });

    return t;
  }, [topics]);

  // --- Handlers ---
  const handleUpdateTopic = (id: string, field: string, value: any) => {
    setTopics(topics.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const handleUpdateMatrix = (id: string, qt: QuestionType, lvl: Level, value: number) => {
    setTopics(topics.map(t => {
      if (t.id !== id) return t;
      return {
        ...t,
        matrix: {
          ...t.matrix,
          [qt]: { ...t.matrix[qt], [lvl]: value }
        }
      };
    }));
  };

  const handleUpdateReq = (id: string, lvl: Level, value: string) => {
    setTopics(topics.map(t => {
      if (t.id !== id) return t;
      return {
        ...t,
        requirements: { ...t.requirements, [lvl]: value }
      };
    }));
  };

  const addTopic = () => {
    const newTopic: Topic = {
      id: Date.now().toString(),
      name: 'Chủ đề mới',
      content: 'Nội dung kiến thức...',
      lessons: 1,
      requirements: { biet: '', hieu: '', vandung: '' },
      matrix: {
        nlc: { biet: 0, hieu: 0, vandung: 0 },
        ds: { biet: 0, hieu: 0, vandung: 0 },
        tln: { biet: 0, hieu: 0, vandung: 0 },
        tl: { biet: 0, hieu: 0, vandung: 0 }
      }
    };
    setTopics([...topics, newTopic]);
  };

  const removeTopic = (id: string) => {
    setTopics(topics.filter(t => t.id !== id));
  };

  const distributePools = (currentTopics: Topic[], pools: { qt: string, lvl: string, count: number }[]) => {
    const totalLessons = currentTopics.reduce((sum, t) => sum + (t.lessons || 0), 0);
    if (totalLessons === 0) return currentTopics;

    let newTopics = currentTopics.map(t => ({
      ...t,
      matrix: {
        nlc: { biet: 0, hieu: 0, vandung: 0 },
        ds: { biet: 0, hieu: 0, vandung: 0 },
        tln: { biet: 0, hieu: 0, vandung: 0 },
        tl: { biet: 0, hieu: 0, vandung: 0 }
      }
    }));

    pools.forEach(pool => {
      let remaining = pool.count;
      const shares = newTopics.map(t => {
        const exact = pool.count * ((t.lessons || 0) / totalLessons);
        const floor = Math.floor(exact);
        return { id: t.id, exact, floor, remainder: exact - floor };
      });

      // Assign floors
      shares.forEach(share => {
        const topic = newTopics.find(t => t.id === share.id)!;
        topic.matrix[pool.qt as QuestionType][pool.lvl as Level] += share.floor;
        remaining -= share.floor;
      });

      // Sort by remainder descending
      shares.sort((a, b) => b.remainder - a.remainder);

      // Distribute remaining
      for (let i = 0; i < remaining; i++) {
        const topic = newTopics.find(t => t.id === shares[i].id)!;
        topic.matrix[pool.qt as QuestionType][pool.lvl as Level] += 1;
      }
    });

    return newTopics;
  };

  const handleAutoDistribute7991 = () => {
    if (topics.length === 0) {
      showAlert('Lỗi', 'Vui lòng thêm ít nhất một chủ đề.');
      return;
    }

    const totalLessons = topics.reduce((sum, t) => sum + (t.lessons || 0), 0);
    if (totalLessons === 0) {
      showAlert('Lỗi', 'Tổng số tiết phải lớn hơn 0 để chia tỉ lệ.');
      return;
    }

    showConfirm(
      'Xác nhận',
      'Bạn có chắc chắn muốn tự động chia lại ma trận theo tỉ lệ Công văn 7991 (40% Biết - 30% Hiểu - 30% Vận dụng)? Dữ liệu ma trận hiện tại sẽ bị ghi đè.',
      () => {
        // Standard pools based on 40-30-30 ratio and 10 points total
        // 12 nlc (3đ), 2 ds (2đ), 4 tln (2đ), 3 tl (3đ)
        const pools = [
          { qt: 'nlc', lvl: 'biet', count: 12 },
          { qt: 'ds', lvl: 'biet', count: 1 },
          { qt: 'ds', lvl: 'hieu', count: 1 },
          { qt: 'tln', lvl: 'hieu', count: 4 },
          { qt: 'tl', lvl: 'vandung', count: 3 }
        ];

        setTopics(distributePools(topics, pools));
        showAlert('Thành công', 'Đã tự động chia câu hỏi thành công!');
      }
    );
  };

  const handleGradeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedGrade(Number(e.target.value));
    setExam(null);
  };

  const applyStructure = (type: string) => {
    if (topics.length === 0) return;
    
    const totalLessons = topics.reduce((sum, t) => sum + (t.lessons || 0), 0);
    if (totalLessons === 0) {
      showAlert('Lỗi', 'Tổng số tiết phải lớn hơn 0 để chia tỉ lệ.');
      return;
    }

    let pools: { qt: string, lvl: string, count: number }[] = [];

    if (type === '70-30') {
      // 70% TN (7 pts), 30% TL (3 pts)
      pools = [
        { qt: 'nlc', lvl: 'biet', count: 6 },
        { qt: 'nlc', lvl: 'hieu', count: 6 },
        { qt: 'ds', lvl: 'biet', count: 1 },
        { qt: 'ds', lvl: 'hieu', count: 1 },
        { qt: 'tln', lvl: 'hieu', count: 2 },
        { qt: 'tln', lvl: 'vandung', count: 2 },
        { qt: 'tl', lvl: 'vandung', count: 3 }
      ];
    } else if (type === '20-80') {
      // 20% TN (2 pts), 80% TL (8 pts)
      pools = [
        { qt: 'nlc', lvl: 'biet', count: 4 },
        { qt: 'nlc', lvl: 'hieu', count: 4 },
        { qt: 'tl', lvl: 'biet', count: 3 },
        { qt: 'tl', lvl: 'hieu', count: 3 },
        { qt: 'tl', lvl: 'vandung', count: 2 }
      ];
    }
    
    setTopics(distributePools(topics, pools));
    showAlert('Thành công', `Đã áp dụng cấu trúc ${type === '70-30' ? '70% Trắc nghiệm - 30% Tự luận' : '20% Trắc nghiệm - 80% Tự luận'}`);
  };

  const handleSaveData = () => {
    try {
      localStorage.setItem('exam_topics_by_grade_v3', JSON.stringify(topicsByGrade));
      showAlert('Thành công', 'Đã lưu dữ liệu thành công! Dữ liệu sẽ được khôi phục trong lần truy cập tiếp theo.');
    } catch (error) {
      console.error('Error saving data:', error);
      showAlert('Lỗi', 'Không thể lưu dữ liệu. Vui lòng thử lại.');
    }
  };

  const handleAutoClassify = (topicId: string) => {
    const topic = topics.find(t => t.id === topicId);
    if (!topic || !topic.rawRequirements) return;

    const classified = autoClassifyRequirements(topic.rawRequirements);

    setTopics(topics.map(t => {
      if (t.id !== topicId) return t;
      return {
        ...t,
        requirements: classified
      };
    }));
  };

  const generateExam = async () => {
    if (totals.all.totalQs === 0) {
      showAlert('Lỗi', 'Ma trận chưa có câu hỏi nào. Vui lòng nhập liệu hoặc chia tỉ lệ trước.');
      return;
    }

    setIsGenerating(true);
    setActiveTab('exam');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Prepare the prompt based on the matrix
      const matrixSummary = topics.map(t => {
        const qDetails = [];
        (['nlc', 'ds', 'tln', 'tl'] as QuestionType[]).forEach(qt => {
          (['biet', 'hieu', 'vandung'] as Level[]).forEach(lvl => {
            const count = t.matrix[qt][lvl];
            if (count > 0) {
              qDetails.push(`${count} câu ${qt === 'nlc' ? 'Trắc nghiệm nhiều lựa chọn' : qt === 'ds' ? 'Trắc nghiệm Đúng/Sai' : qt === 'tln' ? 'Trắc nghiệm Trả lời ngắn' : 'Tự luận'} mức độ ${lvl === 'biet' ? 'Nhận biết' : lvl === 'hieu' ? 'Thông hiểu' : 'Vận dụng'}`);
            }
          });
        });
        
        return {
          topicName: t.name,
          content: t.content,
          requirements: t.requirements,
          questionsToGenerate: qDetails
        };
      }).filter(t => t.questionsToGenerate.length > 0);

      const prompt = `Bạn là một chuyên gia khảo thí giáo dục. Hãy tạo một đề thi dựa trên ma trận và đặc tả sau:
      
      ${JSON.stringify(matrixSummary, null, 2)}
      
      Yêu cầu:
      1. Nội dung câu hỏi phải bám sát "Yêu cầu cần đạt" của từng chủ đề.
      2. Phân loại mức độ (Nhận biết, Thông hiểu, Vận dụng) phải chính xác.
      3. Đối với câu hỏi Trắc nghiệm nhiều lựa chọn (nlc): Cung cấp 4 phương án A, B, C, D trong mảng 'options'.
      4. Đối với câu hỏi Đúng/Sai (ds): Cung cấp nội dung câu hỏi chính và 4 ý phụ (a, b, c, d) trong mảng 'options'. Đáp án 'correctAnswer' phải ghi rõ Đúng/Sai cho từng ý a, b, c, d.
      5. Đối với câu hỏi Trả lời ngắn (tln): Câu hỏi yêu cầu đáp số hoặc một từ/cụm từ ngắn.
      6. Đối với câu hỏi Tự luận (tl): Câu hỏi yêu cầu trình bày lời giải chi tiết.
      7. Ngôn ngữ: Tiếng Việt.
      8. QUAN TRỌNG: Mọi công thức toán học phải được viết dưới dạng LaTeX (sử dụng $...$ cho công thức trong dòng và $$...$$ cho công thức độc lập).
      
      Trả về kết quả dưới dạng JSON mảng các đối tượng câu hỏi với cấu trúc:
      {
        "id": "unique_string",
        "type": "nlc" | "ds" | "tln" | "tl",
        "topicName": "Tên chủ đề",
        "levelName": "Biết | Hiểu | Vận dụng",
        "content": "Nội dung câu hỏi",
        "options": ["A", "B", "C", "D"] (chỉ dành cho nlc và ds),
        "correctAnswer": "Đáp án đúng",
        "explanation": "Giải thích ngắn gọn"
      }`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                topicName: { type: Type.STRING },
                levelName: { type: Type.STRING },
                type: { type: Type.STRING, enum: ["nlc", "ds", "tln", "tl"] },
                level: { type: Type.STRING, enum: ["biet", "hieu", "vandung"] },
                content: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctAnswer: { type: Type.STRING },
                explanation: { type: Type.STRING }
              },
              required: ["type", "content", "correctAnswer"]
            }
          }
        }
      });

      const questions = JSON.parse(response.text);
      setExam({
        id: Date.now().toString(),
        title: 'Đề kiểm tra định kì',
        questions: questions.map((q: any, idx: number) => ({ ...q, id: idx.toString() })),
        createdAt: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error generating exam:', error);
      showAlert('Lỗi', 'Không thể tạo đề thi tự động. Vui lòng kiểm tra lại kết nối hoặc thử lại sau.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const html = result.value;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const rows = Array.from(doc.querySelectorAll('tr'));
      
      let currentTopic = '';
      let currentContent = '';
      
      const parsedTopics: { name: string; content: string; reqs: string }[] = [];
      
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td, th')).map(td => {
           let cellHtml = td.innerHTML;
           // Thay thế các thẻ block thành xuống dòng để giữ nguyên cấu trúc khi lấy text
           cellHtml = cellHtml.replace(/<br\s*\/?>/gi, '\n');
           cellHtml = cellHtml.replace(/<\/p>/gi, '\n');
           cellHtml = cellHtml.replace(/<\/li>/gi, '\n');
           
           const tempDiv = document.createElement('div');
           tempDiv.innerHTML = cellHtml;
           return tempDiv.textContent?.trim() || '';
        });
        
        if (cells.length === 0) return;
        
        // Skip header row
        if (cells.some(c => c.toLowerCase().includes('yêu cầu cần đạt'))) return;
        
        let topicName = currentTopic;
        let content = currentContent;
        let reqs = '';
        
        if (cells.length >= 3) {
          topicName = cells[0] || currentTopic;
          content = cells[1] || currentContent;
          reqs = cells[2];
        } else if (cells.length === 2) {
          content = cells[0] || currentContent;
          reqs = cells[1];
        } else if (cells.length === 1) {
          reqs = cells[0];
        }
        
        if (topicName) currentTopic = topicName;
        if (content) currentContent = content;
        
        if (reqs) {
          parsedTopics.push({ name: topicName, content, reqs });
        }
      });
      
      // Group by topic and content
      const grouped: Record<string, { name: string; content: string; reqs: string[] }> = {};
      parsedTopics.forEach(pt => {
         const key = pt.name + '|||' + pt.content;
         if (!grouped[key]) {
             grouped[key] = { name: pt.name, content: pt.content, reqs: [] };
         }
         grouped[key].reqs.push(pt.reqs);
      });

      const newTopics: Topic[] = Object.values(grouped).map((g, idx) => {
        const rawReqs = g.reqs.join('\n');
        const classified = autoClassifyRequirements(rawReqs);
        
        return {
          id: Date.now().toString() + idx,
          name: g.name || 'Chủ đề mới',
          content: g.content || 'Nội dung...',
          lessons: 1,
          rawRequirements: rawReqs,
          requirements: classified,
          matrix: {
            nlc: { biet: 0, hieu: 0, vandung: 0 },
            ds: { biet: 0, hieu: 0, vandung: 0 },
            tln: { biet: 0, hieu: 0, vandung: 0 },
            tl: { biet: 0, hieu: 0, vandung: 0 }
          }
        };
      });

      if (newTopics.length > 0) {
        setTopics(prev => [...prev, ...newTopics]);
        showAlert('Thành công', `Đã tải và phân loại thành công ${newTopics.length} nội dung từ file Word!`);
      } else {
        showAlert('Lỗi', 'Không tìm thấy dữ liệu bảng hợp lệ trong file Word. Vui lòng đảm bảo file có chứa bảng với các cột: Tên chủ đề, Nội dung, Yêu cầu cần đạt.');
      }
    } catch (error) {
      console.error('Error parsing word file:', error);
      showAlert('Lỗi', 'Có lỗi xảy ra khi đọc file Word. Vui lòng thử lại.');
    }
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const exportToWord = () => {
    const matrixHtml = document.getElementById('matrix-container')?.innerHTML || '';
    const specHtml = document.getElementById('spec-container')?.innerHTML || '';
    const examHtml = document.getElementById('exam-content')?.innerHTML || '';
    
    let content = '';
    if (activeTab === 'exam' && exam) {
      const examHtml = document.getElementById('exam-paper')?.innerHTML || '';
      const answerKeyHtml = document.getElementById('answer-key')?.innerHTML || '';
      
      content = `
        <div class="exam-section">
          ${examHtml}
        </div>
        ${answerKeyHtml ? `
        <br clear="all" style="page-break-before:always" />
        <div class="answer-key-section">
          ${answerKeyHtml}
        </div>
        ` : ''}
      `;
    } else {
      const matrixHtml = document.getElementById('matrix-container')?.innerHTML || '';
      const specHtml = document.getElementById('spec-container')?.innerHTML || '';
      content = `
        ${matrixHtml.replace(/bg-green-\d+/g, 'bg-green').replace(/bg-yellow-\d+/g, 'bg-yellow').replace(/bg-orange-\d+/g, 'bg-orange')}
        <br clear="all" style="page-break-before:always" />
        ${specHtml.replace(/bg-green-\d+/g, 'bg-green').replace(/bg-yellow-\d+/g, 'bg-yellow').replace(/bg-orange-\d+/g, 'bg-orange')}
      `;
    }
    
    const html = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Xuat Du Lieu</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid black; padding: 6px; text-align: center; vertical-align: middle; }
          th { font-weight: bold; }
          .text-left { text-align: left; }
          .text-center { text-align: center; }
          .font-bold { font-weight: bold; }
          .italic { font-style: italic; }
          .uppercase { text-transform: uppercase; }
          .bg-green { background-color: #bbf7d0; }
          .bg-yellow { background-color: #fef08a; }
          .bg-orange { background-color: #fed7aa; }
          h2 { text-align: center; font-size: 14pt; text-transform: uppercase; }
          .space-y-1 > * + * { margin-top: 0.25rem; }
          .space-y-2 > * + * { margin-top: 0.5rem; }
          .space-y-4 > * + * { margin-top: 1rem; }
          .space-y-6 > * + * { margin-top: 1.5rem; }
          .space-y-8 > * + * { margin-top: 2rem; }
          .mt-2 { margin-top: 0.5rem; }
          .mt-4 { margin-top: 1rem; }
          .mt-6 { margin-top: 1.5rem; }
          .mt-8 { margin-top: 2rem; }
          .mt-12 { margin-top: 3rem; }
          .mb-1 { margin-bottom: 0.25rem; }
          .mb-2 { margin-bottom: 0.5rem; }
          .mb-4 { margin-bottom: 1rem; }
          .mb-6 { margin-bottom: 1.5rem; }
          .mb-8 { margin-bottom: 2rem; }
          .ml-4 { margin-left: 1rem; }
          .w-full { width: 100%; }
          .w-\\[40\\%\\] { width: 40%; }
          .w-\\[60\\%\\] { width: 60%; }
          .w-\\[15\\%\\] { width: 15%; }
          .w-\\[70\\%\\] { width: 70%; }
          .flex { display: flex; }
          .justify-between { justify-content: space-between; }
          .gap-1 { gap: 0.25rem; }
          .gap-2 { gap: 0.5rem; }
          .grid { display: block; }
          .grid-cols-4 > * { display: inline-block; width: 24%; vertical-align: top; }
          .whitespace-nowrap { white-space: nowrap; }
          .align-top { vertical-align: top; }
          .border-none { border: none !important; }
          .border-none td { border: none !important; }
          .whitespace-pre-wrap { white-space: pre-wrap; }
        </style>
      </head>
      <body>
        ${content}
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const filename = activeTab === 'exam' ? 'De_Kiem_Tra.doc' : 'Ma_Tran_Va_Dac_Ta.doc';
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Render Helpers ---
  const renderCell = (val: number) => val > 0 ? val : '';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 print:hidden">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <FileSpreadsheet className="w-6 h-6 text-blue-600" />
            <h1 className="text-xl font-bold text-gray-800">Công cụ tạo Ma trận & Đặc tả</h1>
          </div>
          <select 
            value={selectedGrade} 
            onChange={handleGradeChange}
            className="border-gray-300 rounded-md shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 py-1 px-2 border"
          >
            <option value={6}>Lớp 6</option>
            <option value={7}>Lớp 7</option>
            <option value={8}>Lớp 8</option>
            <option value={9}>Lớp 9</option>
          </select>
        </div>
        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
          <button onClick={() => setActiveTab('input')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'input' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>
            <Settings className="w-4 h-4 inline-block mr-2" /> Nhập liệu
          </button>
          <button onClick={() => setActiveTab('matrix')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'matrix' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>
            <FileSpreadsheet className="w-4 h-4 inline-block mr-2" /> Ma trận
          </button>
          <button onClick={() => setActiveTab('spec')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'spec' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>
            <FileText className="w-4 h-4 inline-block mr-2" /> Bản đặc tả
          </button>
          <button onClick={() => setActiveTab('exam')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'exam' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>
            <Brain className="w-4 h-4 inline-block mr-2" /> Đề thi AI
          </button>
        </div>
        <div className="flex space-x-2">
          <button 
            onClick={generateExam} 
            disabled={isGenerating}
            className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {isGenerating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Tạo đề AI
          </button>
          <button onClick={exportToWord} className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors">
            <Download className="w-4 h-4 mr-2" /> Xuất Word
          </button>
          <button onClick={() => window.print()} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            <Printer className="w-4 h-4 mr-2" /> In PDF
          </button>
        </div>
      </header>

      <main className="p-6 max-w-[1600px] mx-auto">
        
        {/* --- TAB: INPUT --- */}
        <div className={`space-y-6 print:hidden ${activeTab === 'input' ? 'block' : 'hidden'}`}>
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Cấu trúc đề kiểm tra</h2>
            <div className="flex space-x-2">
              <select
                onChange={e => {
                  if (e.target.value) {
                    applyStructure(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                defaultValue=""
              >
                <option value="" disabled>Chọn cấu trúc đề...</option>
                <option value="70-30">70% Trắc nghiệm - 30% Tự luận</option>
                <option value="20-80">20% Trắc nghiệm - 80% Tự luận</option>
              </select>
              <button onClick={handleSaveData} className="flex items-center px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700">
                <Save className="w-4 h-4 mr-2" /> Lưu dữ liệu
              </button>
              <input 
                type="file" 
                accept=".docx" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
              />
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
                <Upload className="w-4 h-4 mr-2" /> Nhập từ Word
              </button>
              <button onClick={handleAutoDistribute7991} className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                <Sparkles className="w-4 h-4 mr-2" /> Chia tỉ lệ (CV 7991)
              </button>
              <button onClick={addTopic} className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700">
                <Plus className="w-4 h-4 mr-2" /> Thêm chủ đề
              </button>
            </div>
          </div>

          {topics.map((topic, index) => (
            <div key={topic.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-gray-800">Chủ đề {index + 1}</h3>
                <button onClick={() => removeTopic(topic.id)} className="text-red-500 hover:text-red-700 p-2"><Trash2 className="w-5 h-5" /></button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6">
                <div className="md:col-span-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tên chủ đề</label>
                  <input type="text" value={topic.name} onChange={e => handleUpdateTopic(topic.id, 'name', e.target.value)} className="w-full p-2 border rounded-md" />
                </div>
                <div className="md:col-span-6">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nội dung / Đơn vị kiến thức</label>
                  <input type="text" value={topic.content} onChange={e => handleUpdateTopic(topic.id, 'content', e.target.value)} className="w-full p-2 border rounded-md" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Số bài</label>
                  <input type="number" value={topic.lessons} onChange={e => handleUpdateTopic(topic.id, 'lessons', parseInt(e.target.value) || 0)} className="w-full p-2 border rounded-md" />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Yêu cầu cần đạt */}
                <div>
                  <h4 className="font-semibold mb-3 text-gray-700 border-b pb-2">Yêu cầu cần đạt (Đặc tả)</h4>
                  
                  {/* Smart Input Box */}
                  <div className="mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-xs font-semibold text-indigo-800">✨ Dán YCCĐ để phân loại tự động</label>
                      <button
                        onClick={() => handleAutoClassify(topic.id)}
                        className="px-2 py-1 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 flex items-center transition-colors"
                      >
                        <Sparkles className="w-3 h-3 mr-1" /> Phân loại
                      </button>
                    </div>
                    <textarea
                      value={topic.rawRequirements || ''}
                      onChange={e => handleUpdateTopic(topic.id, 'rawRequirements', e.target.value)}
                      className="w-full p-2 border border-indigo-200 rounded-md text-sm h-20 outline-none focus:border-indigo-500"
                      placeholder="Dán toàn bộ text Yêu cầu cần đạt từ Word/PDF vào đây..."
                    />
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-green-700 mb-1">Nhận biết</label>
                      <textarea value={topic.requirements.biet} onChange={e => handleUpdateReq(topic.id, 'biet', e.target.value)} className="w-full p-2 border border-green-200 bg-green-50 rounded-md text-sm h-24" placeholder="- Nhận biết được..." />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-yellow-700 mb-1">Thông hiểu</label>
                      <textarea value={topic.requirements.hieu} onChange={e => handleUpdateReq(topic.id, 'hieu', e.target.value)} className="w-full p-2 border border-yellow-200 bg-yellow-50 rounded-md text-sm h-24" placeholder="- Giải thích được..." />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-orange-700 mb-1">Vận dụng</label>
                      <textarea value={topic.requirements.vandung} onChange={e => handleUpdateReq(topic.id, 'vandung', e.target.value)} className="w-full p-2 border border-orange-200 bg-orange-50 rounded-md text-sm h-24" placeholder="- Vận dụng để giải quyết..." />
                    </div>
                  </div>
                </div>

                {/* Phân bổ câu hỏi */}
                <div>
                  <h4 className="font-semibold mb-3 text-gray-700 border-b pb-2">Phân bổ câu hỏi (Ma trận)</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-center border-collapse">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border p-2 text-left">Loại câu hỏi</th>
                          <th className="border p-2 bg-green-100">Biết</th>
                          <th className="border p-2 bg-yellow-100">Hiểu</th>
                          <th className="border p-2 bg-orange-100">Vận dụng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { id: 'nlc', label: 'Nhiều lựa chọn (0.25đ)' },
                          { id: 'ds', label: 'Đúng - Sai (0.25đ)' },
                          { id: 'tln', label: 'Trả lời ngắn (0.5đ)' },
                          { id: 'tl', label: 'Tự luận (1.0đ)' }
                        ].map(qt => (
                          <tr key={qt.id}>
                            <td className="border p-2 text-left font-medium">{qt.label}</td>
                            {(['biet', 'hieu', 'vandung'] as Level[]).map(lvl => (
                              <td key={lvl} className="border p-1">
                                <input 
                                  type="number" min="0" 
                                  value={topic.matrix[qt.id as QuestionType][lvl]} 
                                  onChange={e => handleUpdateMatrix(topic.id, qt.id as QuestionType, lvl, parseInt(e.target.value) || 0)}
                                  className="w-16 p-1 text-center border rounded"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* --- TAB: MATRIX --- */}
        <div id="matrix-container" className={`bg-white p-8 rounded-xl shadow-sm border border-gray-200 overflow-x-auto print:p-0 print:border-none print:shadow-none ${activeTab === 'matrix' ? 'block' : 'hidden'}`}>
          <h2 className="text-xl font-bold text-center mb-6 uppercase">1. Ma trận đề kiểm tra</h2>
          <table className="w-full border-collapse border border-black text-sm text-center">
            <thead>
              <tr>
                <th className="border border-black p-2" rowSpan={5}>TT</th>
                <th className="border border-black p-2" rowSpan={5}>Chủ đề/Chương</th>
                <th className="border border-black p-2" rowSpan={5}>Nội dung/đơn vị kiến thức</th>
                <th className="border border-black p-2 text-red-600" rowSpan={5}>Số bài</th>
                <th className="border border-black p-2" colSpan={12}>Mức độ đánh giá</th>
                <th className="border border-black p-2" colSpan={3} rowSpan={2}>Tổng</th>
                <th className="border border-black p-2" rowSpan={5}>Tỉ lệ % điểm</th>
              </tr>
              <tr>
                <th className="border border-black p-2" colSpan={9}>TNKQ</th>
                <th className="border border-black p-2" colSpan={3}>Tự luận</th>
              </tr>
              <tr>
                <th className="border border-black p-2" colSpan={3}>Nhiều lựa chọn</th>
                <th className="border border-black p-2" colSpan={3}>"Đúng - Sai" <sup>2</sup></th>
                <th className="border border-black p-2" colSpan={3}>Trả lời ngắn <sup>3</sup></th>
                <th className="border border-black p-2" colSpan={3}>Tự luận</th>
                <th className="border border-black p-2 bg-green-300" rowSpan={3}>Biết</th>
                <th className="border border-black p-2 bg-yellow-300" rowSpan={3}>Hiểu</th>
                <th className="border border-black p-2 bg-orange-300" rowSpan={3}>Vận dụng</th>
              </tr>
              <tr>
                <th className="border border-black p-1 italic" colSpan={3}>0.25</th>
                <th className="border border-black p-1 italic" colSpan={3}>0.25</th>
                <th className="border border-black p-1 italic" colSpan={3}>0.5</th>
                <th className="border border-black p-1 italic">1.0</th>
                <th className="border border-black p-1 italic">1.0</th>
                <th className="border border-black p-1 italic">1.0</th>
              </tr>
              <tr>
                <th className="border border-black p-1 bg-green-300">Biết</th>
                <th className="border border-black p-1 bg-yellow-300">Hiểu</th>
                <th className="border border-black p-1 bg-orange-300">Vận dụng</th>
                <th className="border border-black p-1 bg-green-300">Biết</th>
                <th className="border border-black p-1 bg-yellow-300">Hiểu</th>
                <th className="border border-black p-1 bg-orange-300">Vận dụng</th>
                <th className="border border-black p-1 bg-green-300">Biết</th>
                <th className="border border-black p-1 bg-yellow-300">Hiểu</th>
                <th className="border border-black p-1 bg-orange-300">Vận dụng</th>
                <th className="border border-black p-1 bg-green-300">Biết</th>
                <th className="border border-black p-1 bg-yellow-300">Hiểu</th>
                <th className="border border-black p-1 bg-orange-300">Vận dụng</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((topic, idx) => {
                const tBiet = topic.matrix.nlc.biet + topic.matrix.ds.biet + topic.matrix.tln.biet + topic.matrix.tl.biet;
                const tHieu = topic.matrix.nlc.hieu + topic.matrix.ds.hieu + topic.matrix.tln.hieu + topic.matrix.tl.hieu;
                const tVd = topic.matrix.nlc.vandung + topic.matrix.ds.vandung + topic.matrix.tln.vandung + topic.matrix.tl.vandung;
                
                const ptsBiet = (topic.matrix.nlc.biet * POINTS.nlc) + (topic.matrix.ds.biet * POINTS.ds) + (topic.matrix.tln.biet * POINTS.tln) + (topic.matrix.tl.biet * POINTS.tl);
                const ptsHieu = (topic.matrix.nlc.hieu * POINTS.nlc) + (topic.matrix.ds.hieu * POINTS.ds) + (topic.matrix.tln.hieu * POINTS.tln) + (topic.matrix.tl.hieu * POINTS.tl);
                const ptsVd = (topic.matrix.nlc.vandung * POINTS.nlc) + (topic.matrix.ds.vandung * POINTS.ds) + (topic.matrix.tln.vandung * POINTS.tln) + (topic.matrix.tl.vandung * POINTS.tl);
                
                const totalPts = ptsBiet + ptsHieu + ptsVd;
                const percent = (totalPts / 10) * 100;

                return (
                  <tr key={topic.id}>
                    <td className="border border-black p-2">{idx + 1}</td>
                    <td className="border border-black p-2 text-left font-bold">{topic.name}</td>
                    <td className="border border-black p-2 text-left">{topic.content}</td>
                    <td className="border border-black p-2 text-red-600 font-bold">{topic.lessons}</td>
                    
                    <td className="border border-black p-2">{renderCell(topic.matrix.nlc.biet)}</td>
                    <td className="border border-black p-2">{renderCell(topic.matrix.nlc.hieu)}</td>
                    <td className="border border-black p-2">{renderCell(topic.matrix.nlc.vandung)}</td>
                    
                    <td className="border border-black p-2">{renderCell(topic.matrix.ds.biet)}</td>
                    <td className="border border-black p-2">{renderCell(topic.matrix.ds.hieu)}</td>
                    <td className="border border-black p-2">{renderCell(topic.matrix.ds.vandung)}</td>
                    
                    <td className="border border-black p-2">{renderCell(topic.matrix.tln.biet)}</td>
                    <td className="border border-black p-2">{renderCell(topic.matrix.tln.hieu)}</td>
                    <td className="border border-black p-2">{renderCell(topic.matrix.tln.vandung)}</td>
                    
                    <td className="border border-black p-2">{renderCell(topic.matrix.tl.biet)}</td>
                    <td className="border border-black p-2">{renderCell(topic.matrix.tl.hieu)}</td>
                    <td className="border border-black p-2">{renderCell(topic.matrix.tl.vandung)}</td>
                    
                    <td className="border border-black p-2 bg-green-200 font-bold">{renderCell(tBiet)}</td>
                    <td className="border border-black p-2 bg-yellow-200 font-bold">{renderCell(tHieu)}</td>
                    <td className="border border-black p-2 bg-orange-200 font-bold">{renderCell(tVd)}</td>
                    <td className="border border-black p-2">{percent > 0 ? `${percent.toFixed(0)}%` : ''}</td>
                  </tr>
                );
              })}
              
              {/* Footer Rows */}
              <tr className="bg-gray-50 font-bold">
                <td className="border border-black p-2" colSpan={4}>Tổng số câu</td>
                <td className="border border-black p-2 text-green-700">{renderCell(totals.nlc.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.nlc.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.nlc.vandung)}</td>
                
                <td className="border border-black p-2 text-green-700">{renderCell(totals.ds.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.ds.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.ds.vandung)}</td>
                
                <td className="border border-black p-2 text-green-700">{renderCell(totals.tln.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.tln.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.tln.vandung)}</td>
                
                <td className="border border-black p-2 text-green-700">{renderCell(totals.tl.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.tl.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.tl.vandung)}</td>
                
                <td className="border border-black p-2 text-green-700">{renderCell(totals.all.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.all.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.all.vandung)}</td>
                <td className="border border-black p-2">{totals.all.totalQs > 0 ? '100%' : ''}</td>
              </tr>
              <tr className="bg-green-100 font-bold">
                <td className="border border-black p-2" colSpan={4}>Tổng số câu theo loại</td>
                <td className="border border-black p-2" colSpan={3}>{renderCell(totals.nlc.total)}</td>
                <td className="border border-black p-2" colSpan={3}>{renderCell(totals.ds.total)}</td>
                <td className="border border-black p-2" colSpan={3}>{renderCell(totals.tln.total)}</td>
                <td className="border border-black p-2" colSpan={3}>{renderCell(totals.tl.total)}</td>
                <td className="border border-black p-2" colSpan={4}></td>
              </tr>
              <tr className="bg-gray-50 font-bold">
                <td className="border border-black p-2" colSpan={4}>Tổng số điểm</td>
                <td className="border border-black p-2" colSpan={3}>{totals.nlc.points.toFixed(1)}</td>
                <td className="border border-black p-2" colSpan={3}>{totals.ds.points.toFixed(1)}</td>
                <td className="border border-black p-2" colSpan={3}>{totals.tln.points.toFixed(1)}</td>
                <td className="border border-black p-2" colSpan={3}>{totals.tl.points.toFixed(1)}</td>
                <td className="border border-black p-2 text-green-700">{totals.all.pointsPerLevel.biet.toFixed(1)}</td>
                <td className="border border-black p-2 text-yellow-700">{totals.all.pointsPerLevel.hieu.toFixed(1)}</td>
                <td className="border border-black p-2 text-orange-700">{totals.all.pointsPerLevel.vandung.toFixed(1)}</td>
                <td className="border border-black p-2 text-red-600">{totals.all.totalPoints.toFixed(1)}</td>
              </tr>
              <tr className="bg-yellow-100 font-bold">
                <td className="border border-black p-2" colSpan={4}>Tỉ lệ %</td>
                <td className="border border-black p-2" colSpan={3}>{((totals.nlc.points/totals.all.totalPoints)*100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2" colSpan={3}>{((totals.ds.points/totals.all.totalPoints)*100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2" colSpan={3}>{((totals.tln.points/totals.all.totalPoints)*100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2" colSpan={3}>{((totals.tl.points/totals.all.totalPoints)*100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2 text-green-700">{((totals.all.pointsPerLevel.biet / totals.all.totalPoints) * 100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2 text-yellow-700">{((totals.all.pointsPerLevel.hieu / totals.all.totalPoints) * 100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2 text-orange-700">{((totals.all.pointsPerLevel.vandung / totals.all.totalPoints) * 100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2"></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* --- TAB: SPECIFICATION --- */}
        <div id="spec-container" className={`bg-white p-8 rounded-xl shadow-sm border border-gray-200 overflow-x-auto print:p-0 print:border-none print:shadow-none ${activeTab === 'spec' ? 'block' : 'hidden'}`}>
          <h2 className="text-xl font-bold text-center mb-6 uppercase">2. Bản đặc tả đề kiểm tra định kì</h2>
          <table className="w-full border-collapse border border-black text-sm">
            <thead>
              <tr>
                <th className="border border-black p-2 text-center" rowSpan={3}>TT</th>
                <th className="border border-black p-2 text-center" rowSpan={3}>Chủ đề/Chương</th>
                <th className="border border-black p-2 text-center" rowSpan={3}>Nội dung/đơn vị kiến thức</th>
                <th className="border border-black p-2 text-center" rowSpan={3}>Yêu cầu cần đạt</th>
                <th className="border border-black p-2 text-center" colSpan={12}>Số câu hỏi ở các mức độ đánh giá</th>
              </tr>
              <tr>
                <th className="border border-black p-2 text-center" colSpan={9}>TNKQ</th>
                <th className="border border-black p-2 text-center" colSpan={3}>Tự luận</th>
              </tr>
              <tr>
                <th className="border border-black p-1 bg-green-300 text-center">Biết</th>
                <th className="border border-black p-1 bg-yellow-300 text-center">Hiểu</th>
                <th className="border border-black p-1 bg-orange-300 text-center">Vận dụng</th>
                
                <th className="border border-black p-1 bg-green-300 text-center">Biết</th>
                <th className="border border-black p-1 bg-yellow-300 text-center">Hiểu</th>
                <th className="border border-black p-1 bg-orange-300 text-center">Vận dụng</th>
                
                <th className="border border-black p-1 bg-green-300 text-center">Biết</th>
                <th className="border border-black p-1 bg-yellow-300 text-center">Hiểu</th>
                <th className="border border-black p-1 bg-orange-300 text-center">Vận dụng</th>
                
                <th className="border border-black p-1 bg-green-300 text-center">Biết</th>
                <th className="border border-black p-1 bg-yellow-300 text-center">Hiểu</th>
                <th className="border border-black p-1 bg-orange-300 text-center">Vận dụng</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((topic, idx) => (
                <tr key={topic.id}>
                  <td className="border border-black p-2 text-center">{idx + 1}</td>
                  <td className="border border-black p-2 font-bold text-left">{topic.name}</td>
                  <td className="border border-black p-2 text-left">{topic.content}</td>
                  <td className="border border-black p-2 text-left">
                    {topic.requirements.biet && (
                      <div className="mb-2">
                        <strong className="text-green-700">Nhận biết:</strong>
                        <div className="whitespace-pre-wrap">{topic.requirements.biet}</div>
                      </div>
                    )}
                    {topic.requirements.hieu && (
                      <div className="mb-2">
                        <strong className="text-yellow-700">Thông hiểu:</strong>
                        <div className="whitespace-pre-wrap">{topic.requirements.hieu}</div>
                      </div>
                    )}
                    {topic.requirements.vandung && (
                      <div>
                        <strong className="text-orange-700">Vận dụng:</strong>
                        <div className="whitespace-pre-wrap">{topic.requirements.vandung}</div>
                      </div>
                    )}
                  </td>
                  
                  <td className="border border-black p-2 text-center bg-green-50">{renderCell(topic.matrix.nlc.biet)}</td>
                  <td className="border border-black p-2 text-center bg-yellow-50">{renderCell(topic.matrix.nlc.hieu)}</td>
                  <td className="border border-black p-2 text-center bg-orange-50">{renderCell(topic.matrix.nlc.vandung)}</td>
                  
                  <td className="border border-black p-2 text-center bg-green-50">{renderCell(topic.matrix.ds.biet)}</td>
                  <td className="border border-black p-2 text-center bg-yellow-50">{renderCell(topic.matrix.ds.hieu)}</td>
                  <td className="border border-black p-2 text-center bg-orange-50">{renderCell(topic.matrix.ds.vandung)}</td>
                  
                  <td className="border border-black p-2 text-center bg-green-50">{renderCell(topic.matrix.tln.biet)}</td>
                  <td className="border border-black p-2 text-center bg-yellow-50">{renderCell(topic.matrix.tln.hieu)}</td>
                  <td className="border border-black p-2 text-center bg-orange-50">{renderCell(topic.matrix.tln.vandung)}</td>
                  
                  <td className="border border-black p-2 text-center bg-green-50">{renderCell(topic.matrix.tl.biet)}</td>
                  <td className="border border-black p-2 text-center bg-yellow-50">{renderCell(topic.matrix.tl.hieu)}</td>
                  <td className="border border-black p-2 text-center bg-orange-50">{renderCell(topic.matrix.tl.vandung)}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 font-bold text-center">
                <td className="border border-black p-2 text-right" colSpan={4}>Tổng số câu</td>
                <td className="border border-black p-2 text-green-700">{renderCell(totals.nlc.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.nlc.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.nlc.vandung)}</td>
                
                <td className="border border-black p-2 text-green-700">{renderCell(totals.ds.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.ds.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.ds.vandung)}</td>
                
                <td className="border border-black p-2 text-green-700">{renderCell(totals.tln.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.tln.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.tln.vandung)}</td>
                
                <td className="border border-black p-2 text-green-700">{renderCell(totals.tl.biet)}</td>
                <td className="border border-black p-2 text-yellow-700">{renderCell(totals.tl.hieu)}</td>
                <td className="border border-black p-2 text-orange-700">{renderCell(totals.tl.vandung)}</td>
              </tr>
              <tr className="bg-green-100 font-bold text-center">
                <td className="border border-black p-2 text-right" colSpan={4}>Tổng số câu</td>
                <td className="border border-black p-2" colSpan={3}>{renderCell(totals.nlc.total)}</td>
                <td className="border border-black p-2" colSpan={3}>{renderCell(totals.ds.total)}</td>
                <td className="border border-black p-2" colSpan={3}>{renderCell(totals.tln.total)}</td>
                <td className="border border-black p-2" colSpan={3}>{renderCell(totals.tl.total)}</td>
              </tr>
              <tr className="bg-gray-50 font-bold text-center">
                <td className="border border-black p-2 text-right" colSpan={4}>Tổng số điểm</td>
                <td className="border border-black p-2 text-green-700">{totals.nlc.pointsPerLevel.biet.toFixed(1)}</td>
                <td className="border border-black p-2 text-yellow-700">{totals.nlc.pointsPerLevel.hieu.toFixed(1)}</td>
                <td className="border border-black p-2 text-orange-700">{totals.nlc.pointsPerLevel.vandung.toFixed(1)}</td>
                
                <td className="border border-black p-2 text-green-700">{totals.ds.pointsPerLevel.biet.toFixed(1)}</td>
                <td className="border border-black p-2 text-yellow-700">{totals.ds.pointsPerLevel.hieu.toFixed(1)}</td>
                <td className="border border-black p-2 text-orange-700">{totals.ds.pointsPerLevel.vandung.toFixed(1)}</td>
                
                <td className="border border-black p-2 text-green-700">{totals.tln.pointsPerLevel.biet.toFixed(1)}</td>
                <td className="border border-black p-2 text-yellow-700">{totals.tln.pointsPerLevel.hieu.toFixed(1)}</td>
                <td className="border border-black p-2 text-orange-700">{totals.tln.pointsPerLevel.vandung.toFixed(1)}</td>
                
                <td className="border border-black p-2 text-green-700">{totals.tl.pointsPerLevel.biet.toFixed(1)}</td>
                <td className="border border-black p-2 text-yellow-700">{totals.tl.pointsPerLevel.hieu.toFixed(1)}</td>
                <td className="border border-black p-2 text-orange-700">{totals.tl.pointsPerLevel.vandung.toFixed(1)}</td>
              </tr>
              <tr className="bg-gray-50 font-bold text-center text-red-600">
                <td className="border border-black p-2 text-black text-right" colSpan={4}>Tổng số điểm</td>
                <td className="border border-black p-2" colSpan={3}>{totals.nlc.points.toFixed(1)}</td>
                <td className="border border-black p-2" colSpan={3}>{totals.ds.points.toFixed(1)}</td>
                <td className="border border-black p-2" colSpan={3}>{totals.tln.points.toFixed(1)}</td>
                <td className="border border-black p-2" colSpan={3}>{totals.tl.points.toFixed(1)}</td>
              </tr>
              <tr className="bg-yellow-100 font-bold text-center text-red-600">
                <td className="border border-black p-2 text-black text-right" colSpan={4}>Tỉ lệ %</td>
                <td className="border border-black p-2" colSpan={3}>{((totals.nlc.points/totals.all.totalPoints)*100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2" colSpan={3}>{((totals.ds.points/totals.all.totalPoints)*100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2" colSpan={3}>{((totals.tln.points/totals.all.totalPoints)*100 || 0).toFixed(0)}%</td>
                <td className="border border-black p-2" colSpan={3}>{((totals.tl.points/totals.all.totalPoints)*100 || 0).toFixed(0)}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* --- TAB: EXAM --- */}
        <div className={`space-y-6 ${activeTab === 'exam' ? 'block' : 'hidden'}`}>
          {isGenerating ? (
            <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center justify-center space-y-4">
              <RefreshCw className="w-12 h-12 text-purple-600 animate-spin" />
              <h3 className="text-xl font-bold text-gray-800">Đang tạo đề thi bằng AI...</h3>
              <p className="text-gray-500 text-center max-w-md">Gemini đang phân tích ma trận và đặc tả để tạo ra các câu hỏi phù hợp nhất. Quá trình này có thể mất 30-60 giây.</p>
            </div>
          ) : exam ? (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-200 sticky top-20 z-10 print:hidden">
                <div className="flex items-center space-x-4">
                  <h3 className="font-bold text-lg">{exam.title}</h3>
                  <span className="text-xs text-gray-500">Tạo lúc: {new Date(exam.createdAt).toLocaleString('vi-VN')}</span>
                </div>
                <div className="flex space-x-2">
                  <button 
                    onClick={() => setShowAnswers(!showAnswers)} 
                    className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    {showAnswers ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                    {showAnswers ? 'Ẩn đáp án' : 'Hiện đáp án'}
                  </button>
                  <button 
                    onClick={generateExam} 
                    className="flex items-center px-4 py-2 bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" /> Tạo đề khác
                  </button>
                </div>
              </div>

              <div id="exam-paper" className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 print:p-0 print:border-none print:shadow-none">
                {/* Header */}
                <div className="text-center mb-8 space-y-1">
                  <h2 className="text-xl font-bold uppercase">ĐỀ KIỂM TRA ĐỊNH KÌ MÔN TOÁN</h2>
                  <div className="italic">(Thời gian làm bài: 90 phút)</div>
                  <div className="w-full h-px bg-black mt-4"></div>
                </div>

                {/* Questions */}
                <div className="space-y-8">
                  {/* Part I: Multiple Choice */}
                  {exam.questions.some(q => q.type === 'nlc') && (
                    <div>
                      <div className="font-bold uppercase text-lg mb-2">PHẦN I: TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN</div>
                      <div className="border-l-2 border-black pl-4 mb-6 space-y-2">
                        <p><span className="font-bold">Hướng dẫn:</span> Học sinh trả lời từ câu 1 đến câu {exam.questions.filter(q => q.type === 'nlc').length}. Mỗi câu hỏi học sinh chỉ chọn một phương án đúng nhất.</p>
                        <p><span className="font-bold">Điểm:</span> Mỗi câu trả lời đúng được 0,25 điểm.</p>
                      </div>
                      <div className="space-y-8">
                        {exam.questions.filter(q => q.type === 'nlc').map((q, idx) => (
                          <div key={q.id}>
                            <div className="flex gap-1">
                              <span className="font-bold whitespace-nowrap">Câu {idx + 1}. {q.topicName && q.levelName ? `(Chủ đề ${q.topicName} - ${q.levelName})` : ''}</span>
                              <MathMarkdown content={q.content} />
                            </div>
                            <div className="flex flex-col gap-4 mt-4 ml-4">
                              {q.options?.map((opt, oIdx) => (
                                <div key={oIdx} className="flex gap-1">
                                  <span className="font-bold">{String.fromCharCode(65 + oIdx)}.</span>
                                  <MathMarkdown content={opt} />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Part II: True/False */}
                  {exam.questions.some(q => q.type === 'ds') && (
                    <div className="mt-8">
                      <div className="font-bold uppercase text-lg mb-2">PHẦN II: CÂU HỎI ĐÚNG/SAI</div>
                      <div className="border-l-2 border-black pl-4 mb-6 space-y-2">
                        <p><span className="font-bold">Hướng dẫn:</span> Học sinh trả lời từ câu {exam.questions.filter(q => q.type === 'nlc').length + 1} đến câu {exam.questions.filter(q => q.type === 'nlc').length + exam.questions.filter(q => q.type === 'ds').length}. Mỗi câu hỏi gồm các mệnh đề. Học sinh cần xác định mỗi mệnh đề là đúng hay sai.</p>
                        <p><span className="font-bold">Điểm:</span> Mỗi câu trả lời đúng được 0,5 điểm.</p>
                      </div>
                      <div className="space-y-8">
                        {exam.questions.filter(q => q.type === 'ds').map((q, idx) => (
                          <div key={q.id}>
                            <div className="flex gap-1">
                              <span className="font-bold whitespace-nowrap">Câu {exam.questions.filter(q => q.type === 'nlc').length + idx + 1}. {q.topicName && q.levelName ? `(Chủ đề ${q.topicName} - ${q.levelName})` : ''}</span>
                              <MathMarkdown content={q.content} />
                            </div>
                            <table className="w-full border-collapse border border-black mt-4">
                              <thead>
                                <tr>
                                  <th className="border border-black p-2 text-left w-[70%]">Mệnh đề</th>
                                  <th className="border border-black p-2 text-center w-[15%]">Đúng</th>
                                  <th className="border border-black p-2 text-center w-[15%]">Sai</th>
                                </tr>
                              </thead>
                              <tbody>
                                {q.options?.map((opt, oIdx) => (
                                  <tr key={oIdx}>
                                    <td className="border border-black p-2">
                                      <div className="flex gap-1">
                                        <span className="font-bold">{String.fromCharCode(97 + oIdx)})</span>
                                        <MathMarkdown content={opt} />
                                      </div>
                                    </td>
                                    <td className="border border-black p-2 text-center text-2xl">☐</td>
                                    <td className="border border-black p-2 text-center text-2xl">☐</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Part III: Short Answer */}
                  {exam.questions.some(q => q.type === 'tln') && (
                    <div className="mt-8">
                      <div className="font-bold uppercase text-lg mb-2">PHẦN III: CÂU HỎI TRẢ LỜI NGẮN</div>
                      <div className="border-l-2 border-black pl-4 mb-6 space-y-2">
                        <p><span className="font-bold">Hướng dẫn:</span> Học sinh trả lời từ câu {exam.questions.filter(q => q.type === 'nlc').length + exam.questions.filter(q => q.type === 'ds').length + 1} đến câu {exam.questions.filter(q => q.type === 'nlc').length + exam.questions.filter(q => q.type === 'ds').length + exam.questions.filter(q => q.type === 'tln').length}. Viết câu trả lời vào chỗ trống.</p>
                        <p><span className="font-bold">Điểm:</span> Mỗi câu trả lời đúng được 0,5 điểm.</p>
                      </div>
                      <div className="space-y-8">
                        {exam.questions.filter(q => q.type === 'tln').map((q, idx) => (
                          <div key={q.id}>
                            <div className="flex gap-1">
                              <span className="font-bold whitespace-nowrap">Câu {exam.questions.filter(q => q.type === 'nlc').length + exam.questions.filter(q => q.type === 'ds').length + idx + 1}. {q.topicName && q.levelName ? `(Chủ đề ${q.topicName} - ${q.levelName})` : ''}</span>
                              <MathMarkdown content={q.content} />
                            </div>
                            <div className="mt-4">
                              <span className="font-bold">Trả lời: </span>
                              .........................................................................................................
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Part IV: Essay */}
                  {exam.questions.some(q => q.type === 'tl') && (
                    <div className="mt-8">
                      <div className="font-bold uppercase text-lg mb-2">PHẦN IV: TỰ LUẬN</div>
                      <div className="border-l-2 border-black pl-4 mb-6 space-y-2">
                        <p><span className="font-bold">Hướng dẫn:</span> Học sinh trình bày lời giải chi tiết từ câu {exam.questions.filter(q => q.type === 'nlc').length + exam.questions.filter(q => q.type === 'ds').length + exam.questions.filter(q => q.type === 'tln').length + 1} đến câu {exam.questions.length}.</p>
                        <p><span className="font-bold">Điểm:</span> Mỗi câu trả lời đúng được 1,0 điểm.</p>
                      </div>
                      <div className="space-y-8">
                        {exam.questions.filter(q => q.type === 'tl').map((q, idx) => (
                          <div key={q.id}>
                            <div className="flex gap-1">
                              <span className="font-bold whitespace-nowrap">Câu {exam.questions.filter(q => q.type === 'nlc').length + exam.questions.filter(q => q.type === 'ds').length + exam.questions.filter(q => q.type === 'tln').length + idx + 1}. {q.topicName && q.levelName ? `(Chủ đề ${q.topicName} - ${q.levelName})` : ''}</span>
                              <MathMarkdown content={q.content} />
                            </div>
                            <div className="mt-8"></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="mt-12 mb-4">
                  --- HẾT ---
                </div>
                <p className="italic mt-2">Cán bộ coi thi không giải thích gì thêm.</p>
              </div>

              {/* Answer Key */}
              {showAnswers && (
                <div id="answer-key" className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 mt-8 print:p-0 print:border-none print:shadow-none print:mt-0 print:break-before-page">
                  {/* Header */}
                  <table className="w-full mb-6 border-none">
                    <tbody>
                      <tr>
                        <td className="w-[40%] text-center align-top border-none">
                          <div className="font-bold uppercase">TRƯỜNG THCS VŨ LỄ</div>
                          <div className="font-bold uppercase">TỔ KHOA HỌC TỰ NHIÊN</div>
                        </td>
                        <td className="w-[60%] text-center align-top border-none">
                          <div className="font-bold uppercase">HDC KIỂM TRA GIỮA HỌC KỲ II LỚP ……</div>
                          <div className="font-bold uppercase">NĂM HỌC 2025-2026</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="text-center mb-8 space-y-1">
                    <div className="font-bold">Môn: Toán</div>
                    <div className="italic">(Hướng dẫn chấm gồm có 02 trang)</div>
                  </div>

                  <div className="font-bold uppercase mb-2">I. HƯỚNG DẪN CHUNG</div>
                  <p className="mb-2">Học sinh có thể trình bày theo nhiều cách khác nhau nhưng đảm bảo nội dung cơ bản theo đáp án thì vẫn cho điểm tối đa.</p>
                  <p className="mb-6">Điểm toàn bài được lấy đến số thập phân thứ nhất sau khi đã làm tròn số. (Ví dụ: 6,25 làm tròn thành 6,3; 6,75 làm tròn thành 6,8).</p>

                  <div className="font-bold uppercase mb-4">II. HƯỚNG DẪN CHẤM CỤ THỂ</div>
                  
                  {/* Part I Answers */}
                  {exam.questions.some(q => q.type === 'nlc') && (
                    <div className="mb-6">
                      <div className="font-bold uppercase text-lg mb-2">PHẦN I: TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN</div>
                      <div className="italic mb-2">Mỗi câu trả lời đúng được 0,25 điểm</div>
                      <table className="w-full border-collapse border border-black text-center">
                        <tbody>
                          <tr>
                            <td className="border border-black p-2 font-bold">Câu</td>
                            {exam.questions.filter(q => q.type === 'nlc').map((q, idx) => (
                              <td key={idx} className="border border-black p-2">{idx + 1}</td>
                            ))}
                          </tr>
                          <tr>
                            <td className="border border-black p-2 font-bold">Đáp án</td>
                            {exam.questions.filter(q => q.type === 'nlc').map((q, idx) => {
                              let ans = q.correctAnswer;
                              if (ans.startsWith('A') || ans.startsWith('B') || ans.startsWith('C') || ans.startsWith('D')) {
                                ans = ans.charAt(0);
                              }
                              return <td key={idx} className="border border-black p-2 font-bold">{ans}</td>;
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Part II Answers */}
                  {/* Part II Answers */}
                  {exam.questions.some(q => q.type === 'ds') && (
                    <div className="mb-6">
                      <div className="font-bold uppercase text-lg mb-2">PHẦN II: CÂU HỎI ĐÚNG/SAI</div>
                      <div className="italic mb-2">Mỗi câu trả lời đúng được 0,5 điểm</div>
                      <table className="w-full border-collapse border border-black text-center">
                        <tbody>
                          <tr>
                            <td className="border border-black p-2 font-bold">Câu</td>
                            <td className="border border-black p-2 font-bold">Ý</td>
                            <td className="border border-black p-2 font-bold">Đáp án</td>
                          </tr>
                          {exam.questions.filter(q => q.type === 'ds').map((q, idx) => {
                            // Try to parse correctAnswer like "a) Đúng, b) Sai, c) Đúng, d) Sai"
                            const parts = q.correctAnswer.split(',').map(p => p.trim());
                            const hasParts = parts.length > 1;
                            
                            return (
                              <React.Fragment key={idx}>
                                <tr>
                                  <td className="border border-black p-2 font-bold" rowSpan={hasParts ? parts.length : 1}>
                                    {exam.questions.filter(q => q.type === 'nlc').length + idx + 1}
                                  </td>
                                  {hasParts ? (
                                    <>
                                      <td className="border border-black p-2">{parts[0].split(')')[0] || 'a'}</td>
                                      <td className="border border-black p-2 font-bold">{parts[0].split(')')[1]?.trim() || parts[0]}</td>
                                    </>
                                  ) : (
                                    <>
                                      <td className="border border-black p-2">-</td>
                                      <td className="border border-black p-2 font-bold">{q.correctAnswer}</td>
                                    </>
                                  )}
                                </tr>
                                {hasParts && parts.slice(1).map((part, pIdx) => (
                                  <tr key={pIdx}>
                                    <td className="border border-black p-2">{part.split(')')[0] || String.fromCharCode(98 + pIdx)}</td>
                                    <td className="border border-black p-2 font-bold">{part.split(')')[1]?.trim() || part}</td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Part III Answers */}
                  {exam.questions.some(q => q.type === 'tln') && (
                    <div className="mb-6">
                      <div className="font-bold uppercase text-lg mb-2">PHẦN III: CÂU HỎI TRẢ LỜI NGẮN</div>
                      <div className="italic mb-2">Mỗi câu trả lời đúng được 0,5 điểm</div>
                      <table className="w-full border-collapse border border-black text-center">
                        <tbody>
                          <tr>
                            <td className="border border-black p-2 font-bold">Câu</td>
                            <td className="border border-black p-2 font-bold">Đáp án</td>
                          </tr>
                          {exam.questions.filter(q => q.type === 'tln').map((q, idx) => (
                            <tr key={idx}>
                              <td className="border border-black p-2 font-bold w-[15%]">
                                {exam.questions.filter(q => q.type === 'nlc').length + exam.questions.filter(q => q.type === 'ds').length + idx + 1}
                              </td>
                              <td className="border border-black p-2 text-left">
                                <MathMarkdown content={q.correctAnswer} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Part IV Answers */}
                  {exam.questions.some(q => q.type === 'tl') && (
                    <div className="mb-6">
                      <div className="font-bold uppercase text-lg mb-2">PHẦN IV: TỰ LUẬN</div>
                      <div className="italic mb-2">Mỗi câu trả lời đúng được 1,0 điểm</div>
                      <table className="w-full border-collapse border border-black">
                        <tbody>
                          <tr>
                            <td className="border border-black p-2 font-bold text-center w-[15%]">Câu</td>
                            <td className="border border-black p-2 font-bold text-center w-[70%]">Đáp án / Hướng dẫn giải</td>
                            <td className="border border-black p-2 font-bold text-center w-[15%]">Điểm</td>
                          </tr>
                          {exam.questions.filter(q => q.type === 'tl').map((q, idx) => (
                            <tr key={idx}>
                              <td className="border border-black p-2 font-bold text-center align-top">
                                {exam.questions.filter(q => q.type === 'nlc').length + exam.questions.filter(q => q.type === 'ds').length + exam.questions.filter(q => q.type === 'tln').length + idx + 1}
                              </td>
                              <td className="border border-black p-2">
                                <div className="font-bold mb-2">Đáp án:</div>
                                <MathMarkdown content={q.correctAnswer} />
                                {q.explanation && (
                                  <>
                                    <div className="font-bold mt-4 mb-2">Hướng dẫn giải:</div>
                                    <MathMarkdown content={q.explanation} />
                                  </>
                                )}
                              </td>
                              <td className="border border-black p-2 text-center align-top font-bold">1.0</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center justify-center space-y-4">
              <Brain className="w-12 h-12 text-gray-300" />
              <h3 className="text-xl font-bold text-gray-800">Chưa có đề thi nào được tạo</h3>
              <p className="text-gray-500 text-center max-w-md">Hãy hoàn thiện ma trận và nhấn nút "Tạo đề AI" để Gemini giúp bạn soạn thảo đề thi một cách chuyên nghiệp.</p>
              <button 
                onClick={generateExam}
                className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-bold flex items-center"
              >
                <Sparkles className="w-5 h-5 mr-2" /> Bắt đầu tạo đề ngay
              </button>
            </div>
          )}
        </div>

      </main>

      {/* Modal */}
      {modalConfig.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{modalConfig.title}</h3>
            <p className="text-gray-600 mb-6">{modalConfig.message}</p>
            <div className="flex justify-end space-x-3">
              {!modalConfig.isAlert && (
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors font-medium"
                >
                  Hủy
                </button>
              )}
              <button
                onClick={() => {
                  if (modalConfig.onConfirm) modalConfig.onConfirm();
                  closeModal();
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
              >
                {modalConfig.isAlert ? 'Đóng' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
