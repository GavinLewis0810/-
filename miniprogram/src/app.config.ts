export default {
  pages: [
    'pages/index/index',
    'pages/invoices/index',
    'pages/invoice-detail/index',
    'pages/upload/index',
    'pages/reimbursements/index',
    'pages/reimbursement-detail/index',
    'pages/reimbursement-create/index',
    'pages/profile/index',
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#0a0e27',
    navigationBarTitleText: '智能发票报销',
    navigationBarTextStyle: 'white',
    backgroundColor: '#0a0e27',
  },
  tabBar: {
    color: 'rgba(255,255,255,0.45)',
    selectedColor: '#1677ff',
    backgroundColor: '#0a0e27',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/invoices/index',
        text: '发票',
      },
      {
        pagePath: 'pages/reimbursements/index',
        text: '报销',
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
      },
    ],
  },
};
