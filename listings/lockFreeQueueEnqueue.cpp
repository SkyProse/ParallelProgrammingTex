bool enqueue (value_type& val) {
	
	node_type * pNew = node_traits::to_node_ptr(val);
	node_type * t = m_pTail;
	
	while (true) {
		//push forward tail
		node_type * pNext = t->m_pNext.load();
		if (pNext != nullptr) {
			m_pTail.compare_exchange_weak(t, pNext);
			continue;
		}
		
		//actual insertion of a new item
		node_type * tmp = nullptr;
		if (t->m_pNext.compare_exchange_strong(tmp, pNew))
			break;
	}
	
	//attempt to push forward the tail
	//in case of failure, another thread will do this later
	m_pTail.compare_exchange_strong(t, pNew);
	
	return true;
}