import Web3 from 'web3';
import axios from 'axios';
import fs from 'fs';
import chalk from 'chalk';

// 配置
const RPC = 'https://rpc.moksha.vana.org'; // 区块链 RPC 地址
const web3 = new Web3(new Web3.providers.HttpProvider(RPC));
const PRIVATE_KEYS_FILE = 'private_keys.txt'; // 私钥文件路径
const ROUTER_ADDRESS = '0xCFd016891E654869BfEd5D9E9bb76559dF593dbc'; // 合约地址
const ROUTER_ABI = [
    {
        "name": "addFile",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
        "inputs": [
            { "internalType": "string", "name": "url", "type": "string" },
            { "internalType": "string", "name": "encryptedKey", "type": "string" }
        ]
    }
];

// 从文件中读取私钥和推荐码
function readPrivateKeys(file) {
    return fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line.trim()) // 去掉空行
        .map(line => {
            const [privateKey, refCode] = line.split(',');
            return { privateKey: privateKey.trim(), refCode: refCode?.trim() };
        });
}

// 获取消息（nonce）
async function getMessage(address) {
    try {
        const response = await axios.post('https://api.datapig.xyz/api/get-message', { address });
        return response.data.message;
    } catch (error) {
        console.error('获取消息失败:', error.response?.data || error.message);
    }
}

// 签名消息
async function signMessage(privateKey, message) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const signature = account.sign(message);
        return { signature: signature.signature, address: account.address };
    } catch (error) {
        console.error('签名消息失败:', error.message);
    }
}

// 登录获取 token
async function login(address, message, signature) {
    try {
        const response = await axios.post('https://api.datapig.xyz/api/login', { signature, address, message });
        return response.data.token;
    } catch (error) {
        console.error('登录失败:', error.response?.data || error.message);
    }
}

// 获取代币信息
async function getTokens(token) {
    try {
        const response = await axios.get('https://api.datapig.xyz/api/tokens', {
            headers: { Authorization: `Bearer ${token}` },
        });
        return response.data;
    } catch (error) {
        console.error('获取代币失败:', error.response?.data || error.message);
    }
}

// 生成分析
async function generateAnalysis(token, address, preferences, signature, refCode) {
    try {
        const response = await axios.post(
            'https://api.datapig.xyz/api/submit',
            { address, preferences, signature, refCode },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        return response.data;
    } catch (error) {
        if (error.response?.status === 429) {
            console.log('达到每日限制，跳过当前钱包。');
            return null;
        }
        console.error('生成分析失败:', error.response?.data || error.message);
    }
}

// 确认交易哈希
async function confirmHash(token, address, confirmedTxHash) {
    try {
        const response = await axios.post(
            'https://api.datapig.xyz/api/invitedcode',
            { address, confirmedTxHash },
            { headers: { Authorization: `Bearer ${token}` } }
        );
        return response.data;
    } catch (error) {
        console.error('确认交易哈希失败:', error.response?.data || error.message);
    }
}

// 铸造文件
async function mintFile(privateKey, url, encryptedKey, retries = 3) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const contract = new web3.eth.Contract(ROUTER_ABI, ROUTER_ADDRESS);

        const fullUrl = `ipfs://${url}`;
        const gasEstimate = await contract.methods.addFile(fullUrl, encryptedKey).estimateGas({ from: account.address });
        const gasPrice = await web3.eth.getGasPrice();

        const transaction = {
            to: ROUTER_ADDRESS,
            data: contract.methods.addFile(fullUrl, encryptedKey).encodeABI(),
            gas: gasEstimate,
            gasPrice,
        };

        const signedTransaction = await web3.eth.accounts.signTransaction(transaction, privateKey);
        const receipt = await web3.eth.sendSignedTransaction(signedTransaction.rawTransaction);

        console.log('铸造成功，交易哈希:', receipt.transactionHash);
        return receipt.transactionHash;
    } catch (error) {
        console.error(`铸造文件失败（重试次数 ${4 - retries}）:`, error.message);
        if (retries > 1) {
            console.log('1分钟后重试...');
            await new Promise(resolve => setTimeout(resolve, 60000));
            return mintFile(privateKey, url, encryptedKey, retries - 1);
        } else {
            console.error('所有重试失败。');
            throw new Error('铸造失败');
        }
    }
}

// 随机生成偏好
function generateRandomPreferences(tokens) {
    const categories = [
        'Layer 1', 
        'Governance', 
        'Launch Pad', 
        'GameFi & Metaverse',
        'NFT & Collectibles',
        'Layer 2 & Scaling',
        'Infrastructure',
        'Meme & Social',
        'DeFi',
        'DePIN',
        'Others',
        'AI',
        'Liquid Staking',
        'RWA',
        'Murad Picks'
    ];
    
    // 随机选择 3 个类别
    const randomCategories = categories.sort(() => 0.5 - Math.random()).slice(0, 3);

    // 根据随机类别过滤代币
    const matchedTokens = tokens.filter(token =>
        token.categories.some(category => randomCategories.includes(category))
    );

    // 随机选取 13 或 14 个代币
    const selectedTokens = matchedTokens
        .sort(() => 0.5 - Math.random())
        .slice(0, Math.random() < 0.5 ? 13 : 14);

    // 创建喜欢的代币对象
    const likes = selectedTokens.reduce((acc, token) => {
        acc[token.id] = Math.random() < 0.5; // 随机选择喜欢与否
        return acc;
    }, {});

    return { categories: randomCategories, likes };
}

// 打印头部信息
function printHeader() {
    const line = '='.repeat(50);
    const title = '自动生成分析 - Data Pig XYZ';
    const createdBy = '由 子清开源';

    console.log(chalk.cyan(line));
    console.log(chalk.cyan(title));
    console.log(chalk.green(createdBy));
    console.log(chalk.cyan(line));
}

// 主函数
async function mainExecution() {
    printHeader();
    const privateKeyData = readPrivateKeys(PRIVATE_KEYS_FILE);

    for (const { privateKey, refCode } of privateKeyData) {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const address = account.address;

        console.log(chalk.cyan(`当前地址: ${address}`));

        for (let i = 0; i < 5; i++) {
            console.log(chalk.yellow(`开始第 ${i + 1} 次循环`));

            try {
                const message = await getMessage(address);
                if (!message) break;

                const { signature } = await signMessage(privateKey, message);
                if (!signature) break;

                const token = await login(address, message, signature);
                if (!token) break;

                const tokens = await getTokens(token);
                if (!tokens) break;

                const preferences = generateRandomPreferences(tokens);

                const analysisSignature = await signMessage(privateKey, "分析签名消息");
                if (!analysisSignature) break;

                const analysis = await generateAnalysis(token, address, preferences, analysisSignature.signature, refCode);
                if (!analysis) break;

                const txHash = await mintFile(privateKey, analysis.ipfs_hash, analysis.encryptedKey);
                const confirmedHash = await confirmHash(token, address, txHash);

                console.log('交易已确认:', confirmedHash);
            } catch (error) {
                console.error('发生错误:', error.message);
                break;
            }
        }
    }
}

// 每24小时运行一次
setInterval(mainExecution, 86400000);
mainExecution();
