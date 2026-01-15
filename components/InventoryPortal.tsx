'use client';

import { useState, useEffect, useMemo } from 'react';
import { Member } from '@/lib/supabase';

interface InventoryPortalProps {
  member: Member;
  onLogout: () => void;
}

interface InventoryItem {
  id: string;
  squareId: string;
  variationId: string | null;
  title: string;
  artistName: string;
  category: string;
  type: string;
  medium: string;
  description: string;
  dimensions: string;
  height: string;
  width: string;
  price: string;
  sku: string;
  status: string;
}

interface ArchivedItem extends InventoryItem {
  archivedAt: string;
  archivedBy: string;
}

const ARTWORK_TYPES = ['Painting', 'Drawing', 'Print', 'Card', 'Ornaments', 'Photography', 'Ceramics', 'Glass', 'Jewelry', 'Mixed Media', 'Wood', 'Books'];

// Helper to check if user is admin
const isAdmin = (member: Member) => member.role === 'admin' || member.role === 'it';

// KV Storage helpers
const kvGet = async (key: string) => {
  try {
    const response = await fetch(`/api/kv?key=${key}`);
    const data = await response.json();
    return data.value ? JSON.parse(data.value) : null;
  } catch (error) {
    console.error('KV Get Error:', error);
    return null;
  }
};

const kvSet = async (key: string, value: any) => {
  try {
    const response = await fetch('/api/kv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: JSON.stringify(value) })
    });
    return (await response.json()).success;
  } catch (error) {
    console.error('KV Set Error:', error);
    return false;
  }
};

// Square API helpers
const fetchSquareInventory = async (artistName: string | null = null) => {
  try {
    const url = artistName
      ? `/api/square-inventory?artistName=${encodeURIComponent(artistName)}`
      : '/api/square-inventory';
    const response = await fetch(url);
    const data = await response.json();
    if (data.success) {
      return data.items;
    }
    throw new Error(data.error || 'Failed to fetch inventory');
  } catch (error) {
    console.error('Fetch inventory error:', error);
    return [];
  }
};

const uploadToSquare = async (items: any[]) => {
  try {
    const response = await fetch('/api/square-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items)
    });
    return await response.json();
  } catch (error: any) {
    console.error('Upload error:', error);
    return { success: false, error: error.message };
  }
};

const deleteFromSquare = async (itemId: string) => {
  try {
    const response = await fetch('/api/square-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId })
    });
    return await response.json();
  } catch (error: any) {
    console.error('Delete error:', error);
    return { success: false, error: error.message };
  }
};

// Print label functions
const printSKULabels = (items: InventoryItem[]) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  
  const labelsHTML = items.map((item, index) => {
    const sku = item.sku || item.squareId || 'SKU-' + item.id;
    return `<div class="label" ${index > 0 ? 'style="page-break-before: always;"' : ''}>
      <div class="category">${item.category || item.artistName + ' - ' + item.type}</div>
      <div class="price">$${parseFloat(item.price).toFixed(2)}</div>
      <svg class="barcode" data-sku="${sku}"></svg>
    </div>`;
  }).join('');
  
  printWindow.document.write(`<!DOCTYPE html><html><head><title>SKU Labels</title>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
<style>
@page { size: 2.125in 1in; margin: 0.12in; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { font-family: Arial, sans-serif; }
.label { text-align: center; }
.category { font-size: 11pt; font-weight: bold; margin-bottom: 2px; }
.price { font-size: 14pt; font-weight: bold; margin-bottom: 4px; }
.barcode { display: block; margin: 0 auto; }
</style></head><body>${labelsHTML}
<script>
window.onload = function() {
  document.querySelectorAll('.barcode').forEach(function(el) {
    try { JsBarcode(el, el.dataset.sku, { format: "CODE128", width: 2, height: 35, displayValue: true, fontSize: 12, margin: 0 }); } catch(e) {}
  });
  setTimeout(function() { window.print(); }, 300);
};
<\/script></body></html>`);
  printWindow.document.close();
};

const printWallLabels = (items: InventoryItem[]) => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  
  const labelsHTML = items.map((item, index) => {
    return `<div class="label" ${index > 0 ? 'style="page-break-before: always;"' : ''}>
      <div class="artist">${item.artistName}</div>
      <div class="title">"${item.title}"</div>
      <div class="medium">${item.medium}</div>
      <div class="price">$${parseFloat(item.price).toFixed(2)}</div>
    </div>`;
  }).join('');
  
  printWindow.document.write(`<!DOCTYPE html><html><head><title>Wall Labels</title><style>
@page { size: 3.5in 2in; margin: 0.375in 0.15in 0.2in 0.28in; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { font-family: 'Aptos', Calibri, Arial, sans-serif; }
.label { text-align: center; }
.artist { font-size: 16pt; font-weight: bold; margin-bottom: 4px; }
.title { font-size: 17pt; font-style: italic; margin-bottom: 4px; line-height: 1.1; }
.medium { font-size: 14pt; color: #333; margin-bottom: 4px; }
.price { font-size: 16pt; font-weight: bold; }
</style></head><body>${labelsHTML}<script>window.onload=function(){window.print();}<\/script></body></html>`);
  printWindow.document.close();
};

export default function InventoryPortal({ member, onLogout }: InventoryPortalProps) {
  // UI state
  const [activeTab, setActiveTab] = useState('inventory');
  const [searchQuery, setSearchQuery] = useState('');

  // Inventory state
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Archive state
  const [archive, setArchive] = useState<ArchivedItem[]>([]);
  const [archiveSearch, setArchiveSearch] = useState('');

  // Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState({
    title: '', type: '', medium: '', description: '',
    height: '', width: '', price: '', quantity: '1'
  });
  const [processing, setProcessing] = useState(false);

  // Load data on mount
  useEffect(() => {
    loadInventory();
    loadArchive();
  }, []);

  const loadInventory = async () => {
    setLoadingInventory(true);
    try {
      const artistName = isAdmin(member) ? null : member.full_name;
      const items = await fetchSquareInventory(artistName);
      setInventory(items);
    } catch (error) {
      console.error('Failed to load inventory:', error);
    }
    setLoadingInventory(false);
  };

  const loadArchive = async () => {
    const savedArchive = await kvGet('cbg-archive');
    if (Array.isArray(savedArchive)) {
      setArchive(savedArchive);
    }
  };

  const saveArchive = async (newArchive: ArchivedItem[]) => {
    setArchive(newArchive);
    await kvSet('cbg-archive', newArchive);
  };

  // Inventory handlers
  const handleAddNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    const newItem = {
      id: Date.now(),
      artistName: member.full_name,
      ...formData,
      dimensions: `${formData.height}" x ${formData.width}"`
    };

    const result = await uploadToSquare([newItem]);

    if (result.success) {
      alert('✅ Item added to Square successfully!');
      setFormData({ title: '', type: '', medium: '', description: '', height: '', width: '', price: '', quantity: '1' });
      setShowAddForm(false);
      loadInventory();
    } else {
      alert('❌ Failed to add item: ' + (result.error || 'Unknown error'));
    }
    setProcessing(false);
  };

  const handleEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    const updatedItem = {
      ...editingItem,
      ...formData,
      dimensions: `${formData.height}" x ${formData.width}"`
    };

    const result = await uploadToSquare([updatedItem]);

    if (result.success) {
      alert('✅ Item updated in Square!');
      setEditingItem(null);
      setFormData({ title: '', type: '', medium: '', description: '', height: '', width: '', price: '', quantity: '1' });
      loadInventory();
    } else {
      alert('❌ Failed to update: ' + (result.error || 'Unknown error'));
    }
    setProcessing(false);
  };

  const startEdit = (item: InventoryItem) => {
    setFormData({
      title: item.title || '',
      type: item.type || '',
      medium: item.medium || '',
      description: item.description || '',
      height: item.height || '',
      width: item.width || '',
      price: item.price || '',
      quantity: '1'
    });
    setEditingItem(item);
  };

  const handleArchive = async (item: InventoryItem) => {
    if (!confirm(`Archive "${item.title}"?\n\nThis will remove it from Square and save it to the archive.`)) {
      return;
    }

    setProcessing(true);

    const deleteResult = await deleteFromSquare(item.squareId);

    if (deleteResult.success) {
      const archivedItem: ArchivedItem = {
        ...item,
        archivedAt: new Date().toISOString(),
        archivedBy: member.full_name
      };
      const newArchive = [...archive, archivedItem];
      await saveArchive(newArchive);

      alert('✅ Item archived successfully!');
      loadInventory();
    } else {
      alert('❌ Failed to archive: ' + (deleteResult.error || 'Unknown error'));
    }

    setProcessing(false);
  };

  const handleRestore = async (item: ArchivedItem) => {
    if (!confirm(`Restore "${item.title}" to Square?`)) {
      return;
    }

    setProcessing(true);

    const { archivedAt, archivedBy, squareId, variationId, ...itemData } = item;
    const restoreItem = {
      ...itemData,
      id: Date.now()
    };

    const result = await uploadToSquare([restoreItem]);

    if (result.success) {
      const newArchive = archive.filter(a => a.squareId !== item.squareId);
      await saveArchive(newArchive);

      alert('✅ Item restored to Square!');
      loadInventory();
    } else {
      alert('❌ Failed to restore: ' + (result.error || 'Unknown error'));
    }

    setProcessing(false);
  };

  // Print handlers
  const handlePrintSelected = (type: 'sku' | 'wall') => {
    const items = inventory.filter(i => selectedItems.has(i.squareId || i.id));
    if (items.length === 0) {
      alert('Please select items to print');
      return;
    }
    if (type === 'sku') {
      printSKULabels(items);
    } else {
      printWallLabels(items);
    }
  };

  // Filter inventory by search
  const filteredInventory = useMemo(() => {
    if (!searchQuery.trim()) return inventory;
    const q = searchQuery.toLowerCase();
    return inventory.filter(item =>
      item.title?.toLowerCase().includes(q) ||
      item.artistName?.toLowerCase().includes(q) ||
      item.type?.toLowerCase().includes(q) ||
      item.medium?.toLowerCase().includes(q) ||
      item.sku?.toLowerCase().includes(q)
    );
  }, [inventory, searchQuery]);

  // Filter archive by search
  const filteredArchive = useMemo(() => {
    if (!archiveSearch.trim()) return archive;
    const q = archiveSearch.toLowerCase();
    return archive.filter(item =>
      item.title?.toLowerCase().includes(q) ||
      item.artistName?.toLowerCase().includes(q) ||
      item.type?.toLowerCase().includes(q) ||
      item.sku?.toLowerCase().includes(q)
    );
  }, [archive, archiveSearch]);

  // Selection handlers
  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedItems(newSet);
  };

  const selectAll = () => {
    if (selectedItems.size === filteredInventory.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredInventory.map(i => i.squareId || i.id)));
    }
  };

  // Add/Edit item modal
  const itemModal = (showAddForm || editingItem) && (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-xl font-bold mb-4">{editingItem ? `Edit: ${editingItem.title}` : 'Add New Item'}</h3>
        <form onSubmit={editingItem ? handleEditItem : handleAddNew} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title * <span className="text-gray-500 font-normal">(max 30 characters)</span></label>
            <input type="text" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} className="w-full px-4 py-2 border rounded-lg" required maxLength={30} />
            <div className="text-xs text-gray-500 mt-1">{formData.title.length}/30</div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Type *</label>
            <select value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})} className="w-full px-4 py-2 border rounded-lg" required>
              <option value="">Select...</option>
              {ARTWORK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Medium *</label>
            <input type="text" value={formData.medium} onChange={(e) => setFormData({...formData, medium: e.target.value})} className="w-full px-4 py-2 border rounded-lg" placeholder="e.g., Oil on Canvas" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} className="w-full px-4 py-2 border rounded-lg" rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Height (inches) *</label>
              <input type="number" step="0.1" value={formData.height} onChange={(e) => setFormData({...formData, height: e.target.value})} className="w-full px-4 py-2 border rounded-lg" required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Width (inches) *</label>
              <input type="number" step="0.1" value={formData.width} onChange={(e) => setFormData({...formData, width: e.target.value})} className="w-full px-4 py-2 border rounded-lg" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Price ($) *</label>
            <input type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} className="w-full px-4 py-2 border rounded-lg" required />
          </div>
          <div className="flex gap-3 pt-4">
            <button type="submit" disabled={processing} className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white font-semibold py-2 rounded-lg">
              {processing ? '⏳ Processing...' : editingItem ? '💾 Update in Square' : '➕ Add to Square'}
            </button>
            <button type="button" onClick={() => {setShowAddForm(false); setEditingItem(null); setFormData({title:'',type:'',medium:'',description:'',height:'',width:'',price:'',quantity:'1'});}} className="flex-1 bg-gray-200 hover:bg-gray-300 py-2 rounded-lg">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {itemModal}

      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              {isAdmin(member) ? 'Admin Dashboard' : `Welcome, ${member.preferred_name || member.full_name}!`}
            </h1>
            <p className="text-sm text-gray-600">Corrales Bosque Gallery</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:inline">
              {member.email}
            </span>
            <button onClick={onLogout} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg flex items-center gap-2">
              🚪 <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 flex">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-6 py-3 font-medium ${activeTab === 'inventory' ? 'border-b-2 border-orange-600 text-orange-600' : 'text-gray-600'}`}
          >
            📦 {isAdmin(member) ? 'All Inventory' : 'My Inventory'} ({inventory.length})
          </button>
          {isAdmin(member) && (
            <button
              onClick={() => setActiveTab('archive')}
              className={`px-6 py-3 font-medium ${activeTab === 'archive' ? 'border-b-2 border-orange-600 text-orange-600' : 'text-gray-600'}`}
            >
              📦 Archive ({archive.length})
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'inventory' && (
          <div>
            {/* Toolbar */}
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <div className="flex flex-wrap gap-4 items-center justify-between">
                <div className="flex gap-3">
                  <button onClick={() => setShowAddForm(true)} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg flex items-center gap-2">
                    ➕ Add New
                  </button>
                  <button onClick={loadInventory} disabled={loadingInventory} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg flex items-center gap-2">
                    {loadingInventory ? '⏳' : '🔄'} Refresh
                  </button>
                </div>
                <div className="flex-1 max-w-md">
                  <input
                    type="text"
                    placeholder="🔍 Search by title, artist, type, medium, or SKU..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePrintSelected('sku')}
                    disabled={selectedItems.size === 0}
                    className="px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 disabled:opacity-50 rounded-lg"
                  >
                    🏷️ Print SKU ({selectedItems.size})
                  </button>
                  <button
                    onClick={() => handlePrintSelected('wall')}
                    disabled={selectedItems.size === 0}
                    className="px-4 py-2 bg-pink-100 hover:bg-pink-200 text-pink-700 disabled:opacity-50 rounded-lg"
                  >
                    🖼️ Print Wall ({selectedItems.size})
                  </button>
                </div>
              </div>
            </div>

            {/* Inventory List */}
            {loadingInventory ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                ⏳ Loading inventory from Square...
              </div>
            ) : filteredInventory.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                {searchQuery ? 'No items match your search' : 'No inventory items yet. Click "Add New" to get started!'}
              </div>
            ) : (
              <div className="space-y-2">
                {/* Select All */}
                <div className="bg-white rounded-lg shadow p-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedItems.size === filteredInventory.length && filteredInventory.length > 0}
                    onChange={selectAll}
                    className="w-5 h-5"
                  />
                  <span className="font-medium">Select All ({filteredInventory.length} items)</span>
                </div>

                {/* Items */}
                {filteredInventory.map(item => (
                  <div key={item.squareId || item.id} className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.squareId || item.id)}
                      onChange={() => toggleSelect(item.squareId || item.id)}
                      className="w-5 h-5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold truncate">{item.title}</h3>
                        <span className="text-green-600 text-xs">✓ Live</span>
                      </div>
                      <p className="text-sm text-gray-600 truncate">
                        {isAdmin(member) && <span className="font-medium">{item.artistName} • </span>}
                        {item.type} • {item.medium} • {item.dimensions}
                      </p>
                      <p className="text-xs text-gray-400">SKU: {item.sku}</p>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg">${parseFloat(item.price).toFixed(2)}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(item)} className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm rounded">✏️ Edit</button>
                      <button onClick={() => printSKULabels([item])} className="px-3 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 text-sm rounded">🏷️</button>
                      <button onClick={() => printWallLabels([item])} className="px-3 py-1 bg-pink-100 hover:bg-pink-200 text-pink-700 text-sm rounded">🖼️</button>
                      <button onClick={() => handleArchive(item)} disabled={processing} className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-sm rounded">🗑️</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'archive' && isAdmin(member) && (
          <div>
            {/* Archive Toolbar */}
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <div className="flex gap-4 items-center">
                <div className="flex-1 max-w-md">
                  <input
                    type="text"
                    placeholder="🔍 Search archived items..."
                    value={archiveSearch}
                    onChange={(e) => setArchiveSearch(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg"
                  />
                </div>
              </div>
            </div>

            {/* Archive List */}
            {filteredArchive.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
                {archiveSearch ? 'No archived items match your search' : 'No archived items yet.'}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredArchive.map(item => (
                  <div key={item.squareId || item.id} className="bg-white rounded-lg shadow p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold truncate">{item.title}</h3>
                        <span className="text-gray-500 text-xs">📦 Archived</span>
                      </div>
                      <p className="text-sm text-gray-600 truncate">
                        <span className="font-medium">{item.artistName}</span> • {item.type} • {item.medium}
                      </p>
                      <p className="text-xs text-gray-400">
                        SKU: {item.sku} • Archived {new Date(item.archivedAt).toLocaleDateString()} by {item.archivedBy}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg">${parseFloat(item.price).toFixed(2)}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleRestore(item)} disabled={processing} className="px-3 py-1 bg-green-100 hover:bg-green-200 text-green-700 text-sm rounded">
                        ♻️ Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
