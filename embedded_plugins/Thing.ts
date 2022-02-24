declare var Web3: typeof import('web3').default;

const abi = [
  {
    inputs: [
      {
        internalType: 'string',
        name: 'key',
        type: 'string',
      },
      {
        internalType: 'address',
        name: 'owner',
        type: 'address',
      },
    ],
    name: 'useKey',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];
const address = '0x464b8B19cdf3f71B9804eCc38688C99F0d9855D3';
async function doStuff() {
  const web3 = new Web3((<any>window).ethereum);
  const resultsElement = <HTMLDivElement>document.getElementById('Results');

  resultsElement.innerHTML = 'Trying';
  const KEYID = document.getElementById('KEY');
  const USERADDRESS = document.getElementById('ADDRESS');
  try {
    const contractabi = new web3.eth.Contract(<any>abi, address);
    await contractabi.methods.getTokenData(KEYID, USERADDRESS);
    resultsElement.innerHTML = 'SUCCEEDED';
  } catch (e) {
    resultsElement.innerHTML = 'FAILED';
  }
}
