export default {
  pages: [
    'pages/index/index',
    'pages/dashboard/index',
    'pages/invoices/index',
    'pages/invoice-detail/index',
    'pages/upload/index',
    'pages/reimbursements/index',
    'pages/reimbursement-detail/index',
    'pages/reimbursement-create/index',
    'pages/applications/index',
    'pages/application-create/index',
    'pages/borrowings/index',
    'pages/borrowing-create/index',
    'pages/bank-cards/index',
    'pages/notifications/index',
    'pages/profile/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#2f54eb',
    navigationBarTitleText: '智能发票报销',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f7f8fa',
  },
  tabBar: {
    color: '#969799',
    selectedColor: '#2f54eb',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/dashboard/index',
        text: '工作台',
      },
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
